#!/bin/bash
gunicorn -k uvicorn.workers.UvicornWorker app.main:app --workers 1 --threads 1 --timeout 120 --bind 0.0.0.0:8000 --access-logfile - --error-logfile -
