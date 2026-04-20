#!/usr/bin/env bash
#
# AlphaDesk nightly backup
# ------------------------
#   * Dumps the TimescaleDB Postgres database inside the `alphadesk-timescaledb`
#     container to /var/lib/alphadesk/backups/<YYYYMMDD-HHMMSS>.sql.gz
#   * Optionally syncs to the `hetzner-s3` rclone remote if configured.
#   * Retention: deletes local dumps older than 30 days.
#
# Options:
#   --dry-run      Skip pg_dump / rclone / delete; print what would run.
#   --test-db=URL  Run pg_dump against an ad-hoc URL (for local verification).
#                  Skips the docker-exec path entirely.
#
# Exit codes:
#   0  success
#   1  dump failed
#   2  prerequisites missing
#   3  invalid arguments
#
set -euo pipefail

BACKUP_DIR="${ALPHADESK_BACKUP_DIR:-/var/lib/alphadesk/backups}"
CONTAINER_NAME="${ALPHADESK_TIMESCALEDB_CONTAINER:-alphadesk-timescaledb}"
DB_NAME="${ALPHADESK_DB_NAME:-alphadesk}"
DB_USER="${ALPHADESK_DB_USER:-alphadesk}"
REMOTE="${ALPHADESK_BACKUP_REMOTE:-hetzner-s3:alphadesk-backups}"
RETENTION_DAYS="${ALPHADESK_BACKUP_RETENTION_DAYS:-30}"
# Redis AOF source path on the host (see docker-compose.prod.yml redis volume).
# Redis 7 splits AOF into multiple files (base + incremental + manifest); we
# tar the whole thing. Older layouts (single appendonly.aof) are handled by
# the `|| echo` fallback in the backup block below.
AOF_SRC="${ALPHADESK_REDIS_AOF_DIR:-/var/lib/alphadesk/redis}"

DRY_RUN=0
TEST_DB_URL=""

# --- arg parsing ------------------------------------------------------------
for arg in "$@"; do
    case "$arg" in
        --dry-run)
            DRY_RUN=1
            ;;
        --test-db=*)
            TEST_DB_URL="${arg#--test-db=}"
            ;;
        -h|--help)
            sed -n '2,25p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg" >&2
            exit 3
            ;;
    esac
done

log() {
    printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

run() {
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log "DRY-RUN: $*"
    else
        eval "$@"
    fi
}

# --- run --------------------------------------------------------------------
DATE="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="$BACKUP_DIR/$DATE.sql.gz"

log "Starting backup (dry-run=$DRY_RUN, test-db=${TEST_DB_URL:-none})"

if [[ "$DRY_RUN" -eq 0 ]]; then
    mkdir -p "$BACKUP_DIR"
fi

# --- pg_dump ----------------------------------------------------------------
if [[ -n "$TEST_DB_URL" ]]; then
    if ! command -v pg_dump >/dev/null 2>&1; then
        echo "pg_dump not found on PATH (required for --test-db mode)" >&2
        exit 2
    fi
    log "Dumping via pg_dump against test URL -> $DUMP_FILE"
    run "pg_dump '$TEST_DB_URL' | gzip > '$DUMP_FILE'"
else
    if ! command -v docker >/dev/null 2>&1; then
        echo "docker not found on PATH" >&2
        exit 2
    fi
    log "Dumping from container '$CONTAINER_NAME' -> $DUMP_FILE"
    run "docker exec $CONTAINER_NAME pg_dump -U $DB_USER $DB_NAME | gzip > '$DUMP_FILE'"
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
    if [[ ! -s "$DUMP_FILE" ]]; then
        log "ERROR: dump file is empty — aborting so we don't overwrite good backups"
        rm -f "$DUMP_FILE"
        exit 1
    fi
    log "Dump size: $(du -h "$DUMP_FILE" | awk '{print $1}')"
fi

# --- Redis AOF snapshot -----------------------------------------------------
# Capture the Redis append-only files so we can recover brackets-outbox /
# idempotency / rate-limit state on a total host loss. pg_dump covers the
# database; without this, a VPS-wipe rebuild would silently drop any in-flight
# Redis-only state (notably the bracket outbox that replay_pending_brackets()
# consumes at boot). Redis 7 uses a multi-file AOF layout under an appendonlydir/
# subdirectory or top-level incremental files — both live under $AOF_SRC. The
# `|| echo` keeps the backup green on older layouts so we don't lose the pg
# dump when Redis was restarted into a different version.
AOF_ARCHIVE="$BACKUP_DIR/redis-aof-$DATE.tgz"
log "Snapshotting Redis AOF -> $AOF_ARCHIVE"
run "tar -czf '$AOF_ARCHIVE' -C '$AOF_SRC' appendonly.aof.1.incr.aof appendonly.aof.1.base.aof appendonly.aof.manifest 2>/dev/null || echo 'redis aof files not found, skipping'"

# --- offsite copy (mandatory) ----------------------------------------------
# Off-host backup is non-negotiable for a single-VPS deployment: a host-level
# disk loss vaporises /var/lib/alphadesk/backups alongside the live data. We
# previously treated rclone as optional and silently continued on a missing
# binary, which produced successful-looking nightly runs while leaving zero
# offsite copies. Fail loud instead.
if ! command -v rclone >/dev/null; then
    echo "FATAL: rclone not installed — off-host backup is required. Install rclone and configure the 'alphadesk-backups' remote." >&2
    exit 1
fi

if rclone listremotes 2>/dev/null | grep -q "^${REMOTE%%:*}:"; then
    log "Syncing pg dump to rclone remote $REMOTE"
    run "rclone copy '$DUMP_FILE' '$REMOTE/daily/'"
    # Push the AOF archive too — only if it exists (older Redis layouts above
    # may have skipped creating it). Missing file is fine, don't abort.
    if [[ -f "$AOF_ARCHIVE" ]]; then
        log "Syncing redis AOF archive to rclone remote $REMOTE"
        run "rclone copy '$AOF_ARCHIVE' '$REMOTE/daily/'"
    fi
else
    echo "FATAL: rclone remote '${REMOTE%%:*}' not configured. Run 'rclone config' on the host and add it." >&2
    exit 1
fi

# --- retention --------------------------------------------------------------
log "Pruning local dumps older than ${RETENTION_DAYS} days"
if [[ -d "$BACKUP_DIR" ]]; then
    run "find '$BACKUP_DIR' -type f \( -name '*.sql.gz' -o -name 'redis-aof-*.tgz' \) -mtime +${RETENTION_DAYS} -print -delete"
fi

# Matching retention on the remote is best-effort — older rclone versions use
# --min-age, newer ones use days/hours suffixes. Fall back silently.
if rclone listremotes 2>/dev/null | grep -q "^${REMOTE%%:*}:"; then
    log "Pruning remote dumps older than ${RETENTION_DAYS}d"
    run "rclone delete '$REMOTE/daily/' --min-age ${RETENTION_DAYS}d 2>/dev/null || true"
fi

log "Backup complete"
