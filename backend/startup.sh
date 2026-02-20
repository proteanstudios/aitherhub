#!/bin/bash

# Run Alembic migrations (safe to run repeatedly - only applies pending migrations)
echo "Running database migrations..."
python -m alembic upgrade head 2>&1 || echo "Migration warning (may be already up to date)"

# Start the application
gunicorn -k uvicorn.workers.UvicornWorker app.main:app --workers 1 --threads 1 --timeout 120 --bind 0.0.0.0:8000 --access-logfile - --error-logfile -
