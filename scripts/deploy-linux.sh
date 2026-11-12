#!/usr/bin/env bash
# Install a prepared Linux release. Run as root: bash deploy-linux.sh PAYLOAD RELEASE_ID
set -Eeuo pipefail
umask 027

[[ $EUID -eq 0 ]] || { echo 'Run this installer with sudo.' >&2; exit 1; }
payload=$(realpath "${1:?Missing payload directory}")
release_id=${2:?Missing release ID}
[[ $release_id =~ ^daynest-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{7,40}$ ]] || { echo 'Invalid release ID.' >&2; exit 1; }
exec 9>/run/lock/daynest-deploy.lock
flock -n 9 || { echo 'Another Daynest deployment is running.' >&2; exit 1; }
release_dir=/opt/daynest/releases/$release_id
[[ -f $payload/bin/daynest && -f $payload/bin/daynest-backup && -f $payload/assets/index.html ]] || { echo 'Incomplete payload.' >&2; exit 1; }
[[ ! -e $release_dir ]] || { echo 'Release already exists; use a new release ID.' >&2; exit 1; }
if [[ -d $payload/migration && -e /var/lib/daynest/data ]]; then
  echo 'Refusing to replace existing server data with a migration.' >&2
  exit 1
fi

previous_release=''
service_stopped=false
release_switched=false
if [[ -L /opt/daynest/current ]]; then
  previous_release=$(readlink -f /opt/daynest/current)
fi
recover_failed_deployment() {
  result=$?
  trap - EXIT
  if (( result != 0 )); then
    set +e
    if $release_switched && [[ -n $previous_release && -d $previous_release ]]; then
      ln -s "$previous_release" "/opt/daynest/.rollback-$release_id"
      if mv -Tf "/opt/daynest/.rollback-$release_id" /opt/daynest/current; then
        echo 'Deployment failed; previous executable release restored. Data was not rolled back.' >&2
      fi
    fi
    if $service_stopped || $release_switched; then
      systemctl daemon-reload
      systemctl restart daynest.service || echo 'Service recovery failed; inspect daynest.service immediately.' >&2
    fi
  fi
  exit "$result"
}
trap recover_failed_deployment EXIT

getent passwd daynest >/dev/null || useradd --system --user-group --home-dir /var/lib/daynest --shell /usr/sbin/nologin daynest
install -d -m 0755 /opt/daynest /opt/daynest/releases
install -d -m 0750 -o root -g daynest /etc/daynest
install -d -m 0700 -o daynest -g daynest /var/lib/daynest
install -d -m 0755 "$release_dir" "$release_dir/bin"
install -m 0755 "$payload/bin/daynest" "$payload/bin/daynest-backup" "$release_dir/bin/"
cp -a "$payload/assets" "$release_dir/assets"
chown -R root:root "$release_dir"
find "$release_dir/assets" -type d -exec chmod 0755 {} +
find "$release_dir/assets" -type f -exec chmod 0644 {} +

if [[ -d $payload/migration ]]; then
  "$release_dir/bin/daynest-backup" verify --input "$payload/migration" --json
  "$release_dir/bin/daynest-backup" restore --input "$payload/migration" --output /var/lib/daynest/data --apply --json
  chown -R daynest:daynest /var/lib/daynest/data
  chmod -R go-rwx /var/lib/daynest/data
else
  install -d -m 0700 -o daynest -g daynest /var/lib/daynest/data
fi

if [[ ! -e /etc/daynest/daynest.env ]]; then
  jwt_secret=$(openssl rand -hex 32)
  cat > /etc/daynest/daynest.env <<EOF
HTTP_ADDR=0.0.0.0:80
JWT_SECRET=$jwt_secret
JWT_ISSUER=studyflow
TOKEN_TTL=24h
DATA_FILE=/var/lib/daynest/data/studyflow.json
FRONTEND_DIR=/opt/daynest/current/assets
SNAPSHOT_INTERVAL=15s
WORKER_COUNT=4
SHUTDOWN_TIMEOUT=10s
EOF
  unset jwt_secret
  chown root:daynest /etc/daynest/daynest.env
  chmod 0640 /etc/daynest/daynest.env
fi

http_address=$(sed -n 's/^HTTP_ADDR=//p' /etc/daynest/daynest.env | tail -n 1)
health_port=${http_address##*:}
[[ $health_port =~ ^[0-9]+$ ]] || { echo 'Invalid HTTP_ADDR port in server configuration.' >&2; exit 1; }
health_base=http://127.0.0.1:$health_port

if [[ -n $previous_release ]]; then
  backup_dir=/var/backups/daynest/pre-deploy-$release_id
  install -d -m 0700 /var/backups/daynest
  service_stopped=true
  systemctl stop daynest.service
  "$previous_release/bin/daynest-backup" create --data-file /var/lib/daynest/data/studyflow.json --output "$backup_dir" --service-stopped --json
  "$previous_release/bin/daynest-backup" verify --input "$backup_dir" --json
  echo "Pre-deployment backup verified: $backup_dir"
fi

cat > /etc/systemd/system/daynest.service <<'EOF'
[Unit]
Description=Daynest personal workspace
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=daynest
Group=daynest
WorkingDirectory=/opt/daynest/current
EnvironmentFile=/etc/daynest/daynest.env
ExecStart=/opt/daynest/current/bin/daynest
Restart=on-failure
RestartSec=3s
TimeoutStopSec=30s
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/daynest
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 /etc/systemd/system/daynest.service

ln -s "$release_dir" "/opt/daynest/.current-$release_id"
mv -Tf "/opt/daynest/.current-$release_id" /opt/daynest/current
release_switched=true
systemctl daemon-reload
systemctl enable daynest.service
systemctl restart daynest.service
service_stopped=false
for attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 2 "$health_base/healthz" >/dev/null && curl --fail --silent --max-time 2 "$health_base/readyz" >/dev/null; then
    systemctl --no-pager --full status daynest.service
    echo "Deployment ready: $release_id"
    exit 0
  fi
  sleep 1
done
journalctl -u daynest.service -n 40 --no-pager >&2
exit 1
