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

# --- optional remote copy ---------------------------------------------------
if command -v rclone >/dev/null 2>&1; then
    # Only try to push to the remote if rclone actually knows it.
    if rclone listremotes 2>/dev/null | grep -q "^${REMOTE%%:*}:"; then
        log "Syncing to rclone remote $REMOTE"
        run "rclone copy '$DUMP_FILE' '$REMOTE/daily/'"
    else
        log "rclone remote '$REMOTE' not configured — skipping offsite copy"
    fi
else
    log "rclone not installed — skipping offsite copy"
fi

# --- retention --------------------------------------------------------------
log "Pruning local dumps older than ${RETENTION_DAYS} days"
if [[ -d "$BACKUP_DIR" ]]; then
    run "find '$BACKUP_DIR' -type f -name '*.sql.gz' -mtime +${RETENTION_DAYS} -print -delete"
fi

# Matching retention on the remote is best-effort — older rclone versions use
# --min-age, newer ones use days/hours suffixes. Fall back silently.
if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q "^${REMOTE%%:*}:"; then
    log "Pruning remote dumps older than ${RETENTION_DAYS}d"
    run "rclone delete '$REMOTE/daily/' --min-age ${RETENTION_DAYS}d 2>/dev/null || true"
fi

log "Backup complete"
