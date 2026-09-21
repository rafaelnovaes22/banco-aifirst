#!/usr/bin/env bash
set -euo pipefail
pg_bin="${PG_BIN:-/usr/lib/postgresql/16/bin}"
pg_port="${PG_TEST_PORT:-55439}"
pg_dir="$(mktemp -d /tmp/banco-pg-test.XXXXXX)"
trap '"$pg_bin/pg_ctl" -D "$pg_dir" -m immediate -w stop >/dev/null 2>&1 || true' EXIT
"$pg_bin/initdb" -D "$pg_dir" --username=bank_test --auth=trust >/dev/null
"$pg_bin/pg_ctl" -D "$pg_dir" -l "$pg_dir/server.log" -o "-h 127.0.0.1 -p $pg_port -k /tmp" -w start >/dev/null
"$pg_bin/createdb" -h 127.0.0.1 -p "$pg_port" -U bank_test bank_runtime_test
BANK_TEST_DATABASE_URL="postgresql://bank_test@127.0.0.1:$pg_port/bank_runtime_test" npm run test:postgres
