#!/bin/sh
set -eu

data_dir="${DATA_DIR:-/data}"
mkdir -p "$data_dir"

if [ "$(id -u)" = "0" ] && [ "${PUID:-0}" != "0" ]; then
  pgid="${PGID:-$PUID}"
  addgroup -g "$pgid" -S spool 2>/dev/null || true
  adduser -u "$PUID" -S -D -H -G spool spool 2>/dev/null || true
  chown -R "$PUID:$pgid" "$data_dir"
  exec su-exec "$PUID:$pgid" node server/index.js
fi

exec node server/index.js
