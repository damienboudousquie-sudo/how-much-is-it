#!/bin/sh
# Daily backup of what cannot be downloaded again: map types already read, player
# accounts and marks, scan progress. Keeps the last 14 days in /opt/how-much-is-it-backups.
# Installed as a daily job by deploy/setup-jobs.sh.
set -eu
DEST=/opt/how-much-is-it-backups
KEEP=14
mkdir -p "$DEST"
VOLUME=$(docker volume ls -q --filter label=com.docker.compose.volume=app-cache | head -n 1)
[ -n "$VOLUME" ] || { echo "no app-cache volume"; exit 1; }
STAMP=$(date +%Y-%m-%d)
docker run --rm -v "$VOLUME":/data:ro -v "$DEST":/backup alpine:3 \
  sh -c "cd /data && tar czf /backup/how-much-is-it-$STAMP.tar.gz \$(ls -d patterns-v*.json.gz accounts scan-state.json 2>/dev/null)"
ls -1t "$DEST"/how-much-is-it-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "backup: $DEST/how-much-is-it-$STAMP.tar.gz"
