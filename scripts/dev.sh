#!/bin/bash
# Start backend + frontend dev servers. Usage: ./scripts/dev.sh
cd "$(dirname "$0")/.."
trap 'kill 0' EXIT
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000 &
cd frontend && npm run dev -- --open &
wait
