#!/bin/sh
# Restarts the site if it stops answering. Runs every 5 minutes (deploy/setup-jobs.sh).
# Two failed checks in a row are needed, so a slow moment does not cause a restart.
set -u
cd "$(dirname "$0")/.."
STATE=/tmp/how-much-is-it-watchdog
APP=$(docker compose ps -q app 2>/dev/null)
OK=0
if [ -n "$APP" ] && docker exec "$APP" node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
  OK=1
fi
if [ "$OK" = 1 ]; then
  rm -f "$STATE"
  exit 0
fi
if [ -f "$STATE" ]; then
  echo "$(date -Is) site down twice, restarting" >> /var/log/how-much-is-it-watchdog.log
  docker compose up -d >> /var/log/how-much-is-it-watchdog.log 2>&1
  docker compose restart app caddy >> /var/log/how-much-is-it-watchdog.log 2>&1
  rm -f "$STATE"
else
  touch "$STATE"
fi
