#!/usr/bin/env bash
# Cold Post — online SQLite + uploads backup.
#
# Uses SQLite's .backup API (safe while the app is running in WAL mode), then
# encrypts everything with AES-256 before it is written to the backup directory.
# Installed to /usr/local/bin/coldpost-backup.sh and run daily by cron.
#
# Manual run:  sudo DATA_DIR=/var/lib/coldpost/data bash deploy/backup-db.sh
set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/coldpost/data}"
DB_PATH="${DB_PATH:-$DATA_DIR/coldpost.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/coldpost}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
KEY_FILE="${BACKUP_KEY_FILE:-/etc/coldpost/backup.key}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

umask 077
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/files" "$BACKUP_DIR/meta"

[ -f "$DB_PATH" ] || { echo "No database at $DB_PATH" >&2; exit 1; }
[ -f "$KEY_FILE" ] || { echo "Missing backup key $KEY_FILE" >&2; exit 1; }

TMP_DB="$(mktemp -d)/coldpost.db"

echo "[$(date -u +%FT%TZ)] backing up $DB_PATH"
# Consistent snapshot without stopping the application.
sqlite3 "$DB_PATH" ".backup '$TMP_DB'"
INTEGRITY="$(sqlite3 "$TMP_DB" 'PRAGMA integrity_check;')"
if [ "$INTEGRITY" != "ok" ]; then
  echo "Integrity check failed: $INTEGRITY" >&2
  exit 1
fi

encrypt() { openssl enc -aes-256-cbc -pbkdf2 -salt -in "$1" -out "$2" -pass "file:$KEY_FILE"; }

encrypt "$TMP_DB" "$BACKUP_DIR/db/coldpost-$STAMP.db.enc"
rm -rf "$(dirname "$TMP_DB")"

if [ -d "$DATA_DIR/uploads" ]; then
  TAR="$(mktemp -d)/uploads.tar.gz"
  tar -C "$DATA_DIR" -czf "$TAR" uploads
  encrypt "$TAR" "$BACKUP_DIR/files/uploads-$STAMP.tar.gz.enc"
  rm -rf "$(dirname "$TAR")"
fi

# The AES key that protects provider credentials must survive a restore.
if [ -f "$DATA_DIR/app_secret" ]; then
  encrypt "$DATA_DIR/app_secret" "$BACKUP_DIR/meta/app_secret-$STAMP.enc"
fi

# Offsite copy, only when an rclone remote has been configured.
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$BACKUP_DIR" "$BACKUP_RCLONE_REMOTE" --quiet && echo "    copied to $BACKUP_RCLONE_REMOTE"
fi

find "$BACKUP_DIR" -type f -name '*.enc' -mtime "+$RETENTION_DAYS" -delete
echo "[$(date -u +%FT%TZ)] done — $(du -sh "$BACKUP_DIR" | cut -f1) retained"
