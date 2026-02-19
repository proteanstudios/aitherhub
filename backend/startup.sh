#!/bin/bash
echo "=== STARTUP SCRIPT BEGIN ==="
echo "Python version: $(python --version 2>&1)"
echo "Working directory: $(pwd)"
echo "Files: $(ls -la)"
echo "=== Checking imports ==="
python -c "
try:
    from app.main import app
    print('App import OK')
except Exception as e:
    print(f'App import FAILED: {e}')
    import traceback
    traceback.print_exc()
" 2>&1
echo "=== Starting gunicorn ==="
gunicorn -k uvicorn.workers.UvicornWorker app.main:app --workers 1 --threads 1 --timeout 120 --bind 0.0.0.0:8000 --log-level debug --access-logfile - --error-logfile - 2>&1
