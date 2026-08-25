#!/bin/sh
set -eu

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
PGDATA_DIR="${PGDATA_DIR:-$PROJECT_ROOT/.pgdata}"
PGPORT_VALUE="${PGPORT:-5433}"
PG_HOME_DIR="${PG_HOME_DIR:-/opt/homebrew/Cellar/postgresql@18/18.4_1}"
PG_BIN_DIR="${PG_BIN_DIR:-$PG_HOME_DIR/bin}"
PG_SHARE_DIR="${PG_SHARE_DIR:-$PG_HOME_DIR/share/postgresql}"

export PATH="$PG_BIN_DIR:$PATH"
export TZ=UTC

if [ -d "$PGDATA_DIR/base" ]; then
  echo "Postgres data directory already initialized at $PGDATA_DIR"
  exit 0
fi

mkdir -p "$PGDATA_DIR"
initdb -D "$PGDATA_DIR" -L "$PG_SHARE_DIR" --auth=trust --username="${PGUSER:-$USER}" >/dev/null

{
  echo "listen_addresses = '127.0.0.1'"
  echo "port = $PGPORT_VALUE"
} >>"$PGDATA_DIR/postgresql.conf"

echo "Initialized Postgres data directory at $PGDATA_DIR"
