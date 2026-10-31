#!/usr/bin/env bash
# Starts QA Pilot with Docker. First run: creates the settings file (.env) with random
# secrets and an admin password, builds the app (5-15 minutes), then opens the browser.
set -u
cd "$(dirname "$0")/.."
URL="http://localhost:8080"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n\n' "$*"; read -r -p "Press Enter to close this window." _; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  fail "Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ , open it once, then run this again."
fi
if ! docker info >/dev/null 2>&1; then
  say "Starting Docker Desktop..."
  [ "$(uname)" = "Darwin" ] && open -a Docker >/dev/null 2>&1
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
  docker info >/dev/null 2>&1 || fail "Docker is not running. Open Docker Desktop, wait until it says it is running, then run this again."
fi

rand_hex() { if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32; else od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; fi; }
rand_word() { LC_ALL=C tr -dc 'A-HJ-NP-Za-km-z2-9' < /dev/urandom | head -c "$1"; }

if [ ! -f .env ]; then
  say "First run: creating your settings and admin password..."
  PASSWORD="Qa-$(rand_word 10)-7!"
  cp .env.example .env
  # Replace the example values with fresh random ones (works with both macOS and GNU sed).
  sed -i.bak \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$(rand_hex)|" \
    -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(rand_hex)|" \
    -e "s|^SEED_ADMIN_PASSWORD=.*|SEED_ADMIN_PASSWORD=$PASSWORD|" .env && rm -f .env.bak
  cat > QA-Pilot-login.txt <<TXT
QA Pilot - your sign-in
=======================
Address:  $URL
Email:    admin@qapilot.local
Password: $PASSWORD

Change this password after signing in: click your name (top right) > Change password.
To test against the demo shop, use this environment URL inside QA Pilot: http://demo:4600
Keep the .env file safe: it holds the keys that protect stored passwords. Do not delete it.
TXT
fi

say "Building and starting QA Pilot (the first time takes 5-15 minutes)..."
docker compose --profile demo up --build -d || fail "Docker could not start QA Pilot. If port 8080 is in use, set WEB_PORT=8081 in .env and try again."

say "Waiting for QA Pilot to be ready..."
for _ in $(seq 1 200); do
  curl -fsS "$URL/api/health" >/dev/null 2>&1 && break
  sleep 3
done
curl -fsS "$URL/api/health" >/dev/null 2>&1 || fail "QA Pilot did not start in time. Run: docker compose logs api"

say "QA Pilot is running at $URL"
[ -f QA-Pilot-login.txt ] && cat QA-Pilot-login.txt
if [ "$(uname)" = "Darwin" ]; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1; fi
echo
read -r -p "You can close this window; QA Pilot keeps running. Press Enter to close." _
