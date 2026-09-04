#!/usr/bin/env bash
# Bouwt de ontwikkeldatabase opnieuw op, met voorbeeldgegevens.
# Gooit declaratietool_dev weg en maakt hem opnieuw aan.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${DEV_DB_NAAM:-declaratietool_dev}"

psql -d postgres -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists $DB;" -c "create database $DB;" 2>&1 \
  | grep -v "does not exist, skipping" || true

psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/00_auth_shim.sql
for f in supabase/migrations/*.sql; do
  psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f"
done
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/seed.sql
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f scripts/dev-data.sql

echo "Ontwikkeldatabase '$DB' klaar."
