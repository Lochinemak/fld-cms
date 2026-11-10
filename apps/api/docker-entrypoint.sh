#!/bin/sh
set -e

# Brings the database schema up to date before the API starts. Prisma holds a lock while it
# migrates, so replicas starting together are safe. RUN_MIGRATIONS=false leaves it to you.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  ./node_modules/.bin/prisma migrate deploy
fi

exec "$@"
