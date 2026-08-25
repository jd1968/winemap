#!/bin/sh
set -eu

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
PGDATA_DIR="${PGDATA_DIR:-$PROJECT_ROOT/.pgdata}"
PG_HOME_DIR="${PG_HOME_DIR:-/opt/homebrew/Cellar/postgresql@18/18.4_1}"
PG_BIN_DIR="${PG_BIN_DIR:-$PG_HOME_DIR/bin}"

export PATH="$PG_BIN_DIR:$PATH"

if [ ! -d "$PGDATA_DIR/base" ]; then
  echo "Postgres data directory is missing"
  exit 0
fi

pg_ctl -D "$PGDATA_DIR" status >/dev/null 2>&1 || {
  echo "Postgres is not running"
  exit 0
}

pg_ctl -D "$PGDATA_DIR" stop
echo "Postgres stopped"
