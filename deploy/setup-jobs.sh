#!/bin/sh
# Installs the scheduled jobs: daily backup at 04:17, watchdog every 5 minutes.
# Safe to run again (install.sh and update.sh do).
set -eu
DIR=$(cd "$(dirname "$0")/.." && pwd)
chmod +x "$DIR/deploy/backup.sh" "$DIR/deploy/watchdog.sh"
cat > /etc/cron.d/how-much-is-it <<CRON
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 4 * * * root $DIR/deploy/backup.sh >> /var/log/how-much-is-it-backup.log 2>&1
*/5 * * * * root $DIR/deploy/watchdog.sh
CRON
chmod 644 /etc/cron.d/how-much-is-it
if ! command -v cron >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q cron >/dev/null
fi
systemctl enable --now cron >/dev/null 2>&1 || true
echo "Scheduled jobs installed: backup daily 04:17, watchdog every 5 min."
