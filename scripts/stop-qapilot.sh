#!/usr/bin/env bash
# Stops QA Pilot. Your data is kept and comes back the next time you start it.
cd "$(dirname "$0")/.."
docker compose --profile demo stop
echo; read -r -p "QA Pilot is stopped. Press Enter to close." _
