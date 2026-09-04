#!/usr/bin/env bash
# Draait de migraties en de schematests tegen een wegwerpdatabase.
#
#   ./scripts/test-db.sh
#       start zelf een postgres in een tijdelijke map en ruimt die weer op.
#
#   PGHOST=... PGPORT=... PGUSER=... ./scripts/test-db.sh --bestaande-server
#       gebruikt een draaiende server (standaard libpq-variabelen).
#
# Draai dit niet tegen een database met echte gegevens: de testdatabase
# wordt weggegooid en opnieuw aangemaakt.

set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="declaratietool_test"
EIGEN_SERVER=1
[[ "${1:-}" == "--bestaande-server" ]] && EIGEN_SERVER=0

if [[ $EIGEN_SERVER -eq 1 ]]; then
  # Op Debian en Ubuntu staan de postgres-binaries niet in het pad.
  for d in /usr/lib/postgresql/*/bin; do
    [[ -x "$d/initdb" ]] && PATH="$d:$PATH"
  done
  export PATH
  command -v initdb >/dev/null || {
    echo "postgres niet gevonden; installeer postgresql of gebruik --bestaande-server" >&2
    exit 1
  }

  RUNDIR="$(mktemp -d)"
  PORT=54329

  # initdb weigert als root te draaien.
  if [[ "$(id -u)" == "0" ]] && id postgres >/dev/null 2>&1; then
    chown postgres:postgres "$RUNDIR"
    als_postgres() { su postgres -c "PATH=$PATH $*"; }
  else
    als_postgres() { eval "$@"; }
  fi

  opruimen() {
    als_postgres "pg_ctl -D $RUNDIR/data -m immediate stop" >/dev/null 2>&1 || true
    rm -rf "$RUNDIR"
  }
  trap opruimen EXIT

  als_postgres "initdb -D $RUNDIR/data -U postgres --auth=trust" >/dev/null
  als_postgres "pg_ctl -D $RUNDIR/data \
    -o '-p $PORT -k $RUNDIR -c listen_addresses=' -l $RUNDIR/pg.log start" >/dev/null

  export PGHOST="$RUNDIR" PGPORT="$PORT" PGUSER=postgres
fi

psql -d postgres -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists $DB_NAME;" \
  -c "create database $DB_NAME;" 2>&1 | grep -v "does not exist, skipping" || true

# Op Supabase bestaat het auth-schema al; hier zetten we het na.
psql -d "$DB_NAME" -q -v ON_ERROR_STOP=1 -f supabase/tests/00_auth_shim.sql

for f in supabase/migrations/*.sql; do
  echo "  migratie $(basename "$f")"
  psql -d "$DB_NAME" -q -v ON_ERROR_STOP=1 -f "$f"
done

echo
psql -d "$DB_NAME" -q -v ON_ERROR_STOP=1 -f supabase/tests/10_schema_test.sql

# De startgegevens los controleren: die horen op een verse database te passen
# en niet te botsen met wat de tests zelf aanmaken.
echo
psql -d postgres -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists ${DB_NAME}_seed;" \
  -c "create database ${DB_NAME}_seed;" 2>&1 | grep -v "does not exist, skipping" || true
psql -d "${DB_NAME}_seed" -q -v ON_ERROR_STOP=1 -f supabase/tests/00_auth_shim.sql
for f in supabase/migrations/*.sql; do
  psql -d "${DB_NAME}_seed" -q -v ON_ERROR_STOP=1 -f "$f"
done
psql -d "${DB_NAME}_seed" -q -v ON_ERROR_STOP=1 -f supabase/seed.sql
# Twee keer draaien mag geen verschil maken.
psql -d "${DB_NAME}_seed" -q -v ON_ERROR_STOP=1 -f supabase/seed.sql
psql -d "${DB_NAME}_seed" -qtA -v ON_ERROR_STOP=1 -c \
  "select 'Startgegevens geladen: ' || (select count(*) from functie) || ' functies, '
       || (select count(*) from km_tarief) || ' km-tarief.';"
