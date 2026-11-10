#!/usr/bin/env bash
# Run as root after installing nginx and Certbot >= 5.4 in /opt/daynest-certbot.
set -Eeuo pipefail
umask 027
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
public_ip=${1:?Pass the public IPv4 address}
python3 -c 'import ipaddress,sys; assert isinstance(ipaddress.ip_address(sys.argv[1]),ipaddress.IPv4Address)' "$public_ip"
certbot=/opt/daynest-certbot/bin/certbot
[[ -x $certbot && -f /etc/daynest/daynest.env ]] || { echo 'Install nginx/Certbot and deploy Daynest first.' >&2; exit 1; }
if [[ ${2:-} != '--finish' ]]; then
backup_dir=/var/backups/daynest/https-$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0700 "$backup_dir"
cp -a /etc/daynest/daynest.env /etc/systemd/system/daynest.service "$backup_dir/"
install -d -m 0755 /var/www/daynest-acme /var/www/daynest-acme/.well-known /var/www/daynest-acme/.well-known/acme-challenge /etc/nginx/snippets

cat > /etc/nginx/snippets/daynest-proxy.conf <<EOF
client_max_body_size 33m;
gzip on;
gzip_min_length 1024;
gzip_types text/css application/javascript application/json image/svg+xml;
location ^~ /api/v1/ai/ {
    default_type application/json;
    return 403 '{"error":{"code":"local_only","message":"AI authorization is only available on the server itself."}}';
}
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $public_ip;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 150s;
}
EOF
cat > /etc/nginx/sites-available/daynest <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $public_ip;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/daynest-acme;
        default_type text/plain;
    }
    include /etc/nginx/snippets/daynest-proxy.conf;
}
EOF
if [[ -L /etc/nginx/sites-enabled/default ]]; then unlink /etc/nginx/sites-enabled/default; fi
if [[ ! -e /etc/nginx/sites-enabled/daynest ]]; then ln -s /etc/nginx/sites-available/daynest /etc/nginx/sites-enabled/daynest; fi
nginx -t
systemctl stop daynest
trap 'systemctl start daynest' EXIT
/opt/daynest/current/bin/daynest-backup create --data-file /var/lib/daynest/data/studyflow.json --output "$backup_dir/data" --service-stopped --json
sed -i 's/^HTTP_ADDR=.*/HTTP_ADDR=127.0.0.1:8080/' /etc/daynest/daynest.env
systemctl start daynest
systemctl restart nginx
trap - EXIT
curl --fail --silent http://127.0.0.1:8080/healthz
fi

"$certbot" certonly --non-interactive --agree-tos --register-unsafely-without-email \
    --preferred-profile shortlived --webroot --webroot-path /var/www/daynest-acme \
    --ip-address "$public_ip" --cert-name daynest-ip \
    --deploy-hook '/usr/sbin/nginx -t && /bin/systemctl reload nginx'

cat > /etc/nginx/sites-available/daynest <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $public_ip;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/daynest-acme;
        default_type text/plain;
    }
    location / { return 308 https://$public_ip\$request_uri; }
}
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name $public_ip;
    ssl_certificate /etc/letsencrypt/live/daynest-ip/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/daynest-ip/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    include /etc/nginx/snippets/daynest-proxy.conf;
}
EOF
nginx -t
systemctl reload nginx
cat > /etc/systemd/system/daynest-certbot-renew.service <<'EOF'
[Unit]
Description=Renew Daynest HTTPS certificate
After=network-online.target nginx.service
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/opt/daynest-certbot/bin/certbot renew --quiet
TimeoutStartSec=20min
EOF
cat > /etc/systemd/system/daynest-certbot-renew.timer <<'EOF'
[Unit]
Description=Check Daynest HTTPS certificate four times daily
[Timer]
OnCalendar=*-*-* 00,06,12,18:00:00
RandomizedDelaySec=30min
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now daynest-certbot-renew.timer
systemctl enable nginx daynest
curl --fail --silent --connect-timeout 5 --max-time 10 --resolve "$public_ip:443:127.0.0.1" "https://$public_ip/healthz"
echo 'HTTPS configured with automatic certificate renewal.'
