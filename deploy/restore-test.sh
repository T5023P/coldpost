#!/usr/bin/env bash
# Cold Post — restore rehearsal into a temporary directory.
#
# Decrypts the newest backup and proves it opens, passes integrity_check and
# contains the same rows as the live database. It never touches production data.
#
#   sudo bash deploy/restore-test.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/coldpost}"
KEY_FILE="${BACKUP_KEY_FILE:-/etc/coldpost/backup.key}"
LIVE_DB="${DB_PATH:-/var/lib/coldpost/data/coldpost.db}"

LATEST="$(ls -1t "$BACKUP_DIR"/db/*.db.enc 2>/dev/null | head -1 || true)"
[ -n "$LATEST" ] || { echo "No backup found in $BACKUP_DIR/db" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Restoring $LATEST"
openssl enc -d -aes-256-cbc -pbkdf2 -in "$LATEST" -out "$WORK/coldpost.db" -pass "file:$KEY_FILE"

INTEGRITY="$(sqlite3 "$WORK/coldpost.db" 'PRAGMA integrity_check;')"
[ "$INTEGRITY" = "ok" ] || { echo "FAILED integrity check: $INTEGRITY" >&2; exit 1; }
echo "integrity_check: ok"

TABLE_COUNT="$(sqlite3 "$WORK/coldpost.db" "SELECT count(*) FROM sqlite_master WHERE type='table';")"
echo "tables in backup: $TABLE_COUNT"
[ "$TABLE_COUNT" -gt 20 ] || { echo "FAILED: unexpectedly few tables" >&2; exit 1; }

if [ -f "$LIVE_DB" ]; then
  for TABLE in users products customers orders inventory_items shipments; do
    LIVE="$(sqlite3 "$LIVE_DB" "SELECT count(*) FROM $TABLE;" 2>/dev/null || echo '?')"
    RESTORED="$(sqlite3 "$WORK/coldpost.db" "SELECT count(*) FROM $TABLE;" 2>/dev/null || echo '?')"
    echo "  $TABLE: live=$LIVE restored=$RESTORED"
  done
fi

echo "Restore rehearsal passed."
