#!/usr/bin/env bash
#
# Does this migration tree still build the database we run?
#
# Replays every file in supabase/migrations/ onto an empty Postgres in Docker
# and stops at the first one that fails. Run it after adding a migration, and
# before believing that `supabase db reset` would work.
#
# With a database URL in the environment it goes further and diffs the result
# against the real thing — functions, policies, constraints, indexes, columns,
# enums, RLS and triggers — which is the check that catches a tree that applies
# cleanly and produces the wrong database:
#
#     ./supabase/tests/replay.sh              # replay only
#     PGURL='postgres://…' ./supabase/tests/replay.sh --diff
#
set -uo pipefail
cd "$(dirname "$0")/../.."
NAME=wf-replay
PORT=${REPLAY_PORT:-55432}

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running — start it and try again." >&2; exit 2
fi
if ! docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker run -d --name "$NAME" -e POSTGRES_PASSWORD=replay -p "$PORT":5432 postgres:17 >/dev/null
fi
docker start "$NAME" >/dev/null 2>&1
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done

psqlq() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q; }

psqlq < supabase/tests/replay-prelude.sql >/dev/null || { echo "prelude failed"; exit 1; }

fail=0
for f in supabase/migrations/*.sql; do
  n=$(basename "$f")
  if out=$(psqlq < "$f" 2>&1); then
    printf '  ok    %s\n' "$n"
  else
    printf '  FAIL  %s\n' "$n"
    echo "$out" | grep -E 'ERROR|CONTEXT' | head -3 | sed 's/^/          /'
    fail=$((fail+1))
  fi
done
echo "failures: $fail"
[ "$fail" -gt 0 ] && exit 1

if [ "${1:-}" = "--diff" ]; then
  if [ -z "${PGURL:-}" ]; then echo "set PGURL to diff against the real database" >&2; exit 2; fi
  PYLIB="${PYLIB:-}" REPLAY_CONTAINER="$NAME" PGURL="$PGURL" python3 supabase/tests/replay_diff.py
fi
