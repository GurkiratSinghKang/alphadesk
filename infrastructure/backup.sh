#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/tmp/alphadesk-backups"
DATE=$(date +%Y%m%d)
REMOTE="hetzner-s3:alphadesk-backups"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."

# Dump database
docker exec alphadesk-timescaledb pg_dump -U alphadesk alphadesk | gzip > "$BACKUP_DIR/db-$DATE.sql.gz"
echo "Database dumped"

# Copy to remote storage
rclone copy "$BACKUP_DIR/db-$DATE.sql.gz" "$REMOTE/daily/"
echo "Uploaded to remote"

# Clean up local files
rm -f "$BACKUP_DIR"/db-*.sql.gz

# Retain only 7 daily backups remotely
rclone delete "$REMOTE/daily/" --min-age 8d 2>/dev/null || true

echo "[$(date)] Backup complete"
