#!/bin/sh
set -eu

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
PGDATA_DIR="${PGDATA_DIR:-$PROJECT_ROOT/.pgdata}"
LOG_FILE="$PGDATA_DIR/postgres.log"
PG_HOME_DIR="${PG_HOME_DIR:-/opt/homebrew/Cellar/postgresql@18/18.4_1}"
PG_BIN_DIR="${PG_BIN_DIR:-$PG_HOME_DIR/bin}"

export PATH="$PG_BIN_DIR:$PATH"

if [ ! -d "$PGDATA_DIR/base" ]; then
  echo "Postgres data directory is missing. Run npm run db:init first."
  exit 1
fi

mkdir -p "$PGDATA_DIR"
pg_ctl -D "$PGDATA_DIR" -l "$LOG_FILE" status >/dev/null 2>&1 && {
  echo "Postgres is already running"
  exit 0
}

pg_ctl -D "$PGDATA_DIR" -l "$LOG_FILE" start
echo "Postgres started with data dir $PGDATA_DIR"
