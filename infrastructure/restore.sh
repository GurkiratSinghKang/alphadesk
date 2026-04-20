#!/usr/bin/env bash
#
# AlphaDesk restore (Round 7 Fix 5 — P130)
# ----------------------------------------
# Mirror of ``backup.sh``. Pulls a pg_dump archive from the rclone remote
# (or a local path with --local) and loads it into the live
# ``alphadesk-timescaledb`` container. Designed for the "we just lost the
# VPS disk" recovery path, NOT for PITR — we do not ship WAL archives in
# this deployment, so the point you can recover to is the most recent
# nightly dump (RPO ≈ 24 h).
#
# CAVEATS:
#   * NO PITR. If you need sub-day recovery set up WAL archiving first.
#   * Destructive. Drops and recreates the database inside the container.
#     Double-check the environment before running.
#   * Does NOT restore Redis. Redis AOF is snapshotted to
#     ``redis-aof-*.tgz`` by backup.sh for separate manual recovery;
#     transient state (rate-limit counters, bracket outbox) usually
#     isn't worth restoring anyway.
#   * Assumes the target container is running. If it's not, start it
#     first (``docker compose up -d timescaledb``) — the script does NOT
#     manage container lifecycle.
#
# USAGE:
#   ./restore.sh --latest                  # Pull newest .sql.gz from remote.
#   ./restore.sh --dump=20251015-030000.sql.gz
#   ./restore.sh --local=/path/to/dump.sql.gz
#   ./restore.sh --dry-run --latest        # Show what would happen.
#
# Exit codes:
#   0  success
#   1  restore failed
#   2  prerequisites missing (docker / rclone / dump file absent)
#   3  invalid arguments
#
set -euo pipefail

BACKUP_DIR="${ALPHADESK_BACKUP_DIR:-/var/lib/alphadesk/backups}"
CONTAINER_NAME="${ALPHADESK_TIMESCALEDB_CONTAINER:-alphadesk-timescaledb}"
DB_NAME="${ALPHADESK_DB_NAME:-alphadesk}"
DB_USER="${ALPHADESK_DB_USER:-alphadesk}"
REMOTE="${ALPHADESK_BACKUP_REMOTE:-hetzner-s3:alphadesk-backups}"

DRY_RUN=0
MODE=""                  # "latest" | "named" | "local"
DUMP_NAME=""             # when MODE=named
LOCAL_DUMP=""            # when MODE=local
ASSUME_YES=0

# --- arg parsing ------------------------------------------------------------
for arg in "$@"; do
    case "$arg" in
        --dry-run)
            DRY_RUN=1
            ;;
        --latest)
            MODE="latest"
            ;;
        --dump=*)
            MODE="named"
            DUMP_NAME="${arg#--dump=}"
            ;;
        --local=*)
            MODE="local"
            LOCAL_DUMP="${arg#--local=}"
            ;;
        --yes)
            ASSUME_YES=1
            ;;
        -h|--help)
            sed -n '2,40p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg" >&2
            exit 3
            ;;
    esac
done

if [[ -z "$MODE" ]]; then
    echo "One of --latest, --dump=<name>, or --local=<path> is required." >&2
    exit 3
fi

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

# --- preflight --------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
    echo "docker not found on PATH" >&2
    exit 2
fi

# Only require rclone for the remote-download modes.
if [[ "$MODE" != "local" ]] && ! command -v rclone >/dev/null 2>&1; then
    echo "rclone not found on PATH (required unless --local is used)" >&2
    exit 2
fi

# Make sure the target container is actually running, otherwise `docker exec`
# below silently 1s instead of giving us a helpful error.
if [[ "$DRY_RUN" -eq 0 ]]; then
    if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "FATAL: container '${CONTAINER_NAME}' is not running. Start it first:" >&2
        echo "  docker compose up -d timescaledb" >&2
        exit 2
    fi
fi

mkdir -p "$BACKUP_DIR"

# --- resolve the dump file --------------------------------------------------
case "$MODE" in
    latest)
        log "Finding latest pg dump on remote '${REMOTE}/daily/'"
        if [[ "$DRY_RUN" -eq 1 ]]; then
            log "DRY-RUN: would run rclone lsl $REMOTE/daily/ --include '*.sql.gz'"
            DUMP_NAME="latest-stub.sql.gz"
        else
            # rclone lsl output shape: "<size> <date> <time> <name>"
            # Sort by date+time (columns 2-3) descending; pick the filename column.
            DUMP_NAME="$(rclone lsl "$REMOTE/daily/" --include '*.sql.gz' 2>/dev/null \
                | sort -k2,3 -r | head -n 1 | awk '{print $NF}')"
            if [[ -z "$DUMP_NAME" ]]; then
                echo "FATAL: no .sql.gz files found on remote ${REMOTE}/daily/" >&2
                exit 1
            fi
            log "Selected latest dump: $DUMP_NAME"
        fi
        LOCAL_DUMP="$BACKUP_DIR/$DUMP_NAME"
        log "Downloading $DUMP_NAME -> $LOCAL_DUMP"
        run "rclone copy '$REMOTE/daily/$DUMP_NAME' '$BACKUP_DIR/'"
        ;;
    named)
        LOCAL_DUMP="$BACKUP_DIR/$DUMP_NAME"
        if [[ ! -f "$LOCAL_DUMP" ]]; then
            log "Dump not found locally, downloading from remote"
            run "rclone copy '$REMOTE/daily/$DUMP_NAME' '$BACKUP_DIR/'"
        else
            log "Dump already present locally: $LOCAL_DUMP"
        fi
        ;;
    local)
        if [[ ! -f "$LOCAL_DUMP" ]]; then
            echo "FATAL: local dump not found: $LOCAL_DUMP" >&2
            exit 2
        fi
        log "Using local dump: $LOCAL_DUMP"
        ;;
esac

if [[ "$DRY_RUN" -eq 0 ]]; then
    if [[ ! -s "$LOCAL_DUMP" ]]; then
        echo "FATAL: dump file is empty — refusing to overwrite live DB." >&2
        exit 1
    fi
fi

# --- confirm before destroying the live DB ---------------------------------
# This is destructive — drops + recreates the database inside the container.
# Prompt unless --yes was passed. Skipped entirely on dry-run (the script is
# non-destructive there).
if [[ "$DRY_RUN" -eq 0 && "$ASSUME_YES" -eq 0 ]]; then
    printf 'About to DROP + recreate database "%s" inside container "%s" from %s.\n' \
        "$DB_NAME" "$CONTAINER_NAME" "$LOCAL_DUMP"
    printf 'Type "yes" to continue: '
    read -r CONFIRM
    if [[ "$CONFIRM" != "yes" ]]; then
        echo "Aborted."
        exit 3
    fi
fi

# --- restore ----------------------------------------------------------------
# Drop and recreate the DB then pipe the gunzipped dump into psql. We target
# the ``postgres`` maintenance DB for the DROP/CREATE so we're not trying to
# drop the DB we're connected to. The psql restore then connects to the fresh
# DB by name. Errors bubble up through ``set -e``.
log "Dropping + recreating database '$DB_NAME' in container '$CONTAINER_NAME'"
run "docker exec -i '$CONTAINER_NAME' psql -U '$DB_USER' -d postgres -c \"DROP DATABASE IF EXISTS $DB_NAME;\""
run "docker exec -i '$CONTAINER_NAME' psql -U '$DB_USER' -d postgres -c \"CREATE DATABASE $DB_NAME OWNER $DB_USER;\""

log "Restoring dump into '$DB_NAME'"
run "gunzip -c '$LOCAL_DUMP' | docker exec -i '$CONTAINER_NAME' psql -U '$DB_USER' -d '$DB_NAME'"

if [[ "$DRY_RUN" -eq 0 ]]; then
    # Sanity: ensure at least one table landed. A silent "empty dump" would
    # leave a running-but-empty DB and the app would boot with no data; the
    # operator deserves a loud failure here rather than discovering it at
    # market open.
    TABLE_COUNT="$(docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" \
        -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" \
        2>/dev/null || echo 0)"
    if [[ "${TABLE_COUNT:-0}" -lt 1 ]]; then
        echo "FATAL: restore succeeded but public schema is empty. Aborting." >&2
        exit 1
    fi
    log "Post-restore table count (public schema): $TABLE_COUNT"
fi

log "Restore complete"
log "Next steps: run 'alembic upgrade head' inside the backend container to bring schema to the latest migration if the dump is older than the current code."
