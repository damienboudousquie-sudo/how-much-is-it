#!/bin/sh
# Pull the latest version from GitHub and rebuild. Run from the project folder.
set -e
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose up -d --build
sh deploy/setup-jobs.sh
docker image prune -f
docker compose ps
