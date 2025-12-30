#!/bin/bash
set -e

echo "Waiting for database to be ready..."
# Wait for postgres to be ready
until pg_isready -h postgres -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-liveboost} > /dev/null 2>&1; do
  echo "Database is unavailable - sleeping"
  sleep 1
done

echo "Running database migrations..."
alembic upgrade head

echo "Starting application..."
exec "$@"

