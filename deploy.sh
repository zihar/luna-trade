#!/usr/bin/env bash
# Deploy/update Luna Trade ke instance forex-alertd (numpang, tanpa Docker).
#
# Build binary statis arm64 → scp ke instance → restart systemd service.
# Hanya update binary + index.html + assets/; service unit & /etc/bar-replay.env
# (token + basic-auth) sudah terpasang di instance, tidak disentuh.
# Catatan: nama service/path di server tetap "bar-replay" (legacy), tak diubah.
#
# Pakai:  ./deploy.sh
set -euo pipefail

HOST="forex-alertd"                 # alias di ~/.ssh/config
REMOTE_DIR="/opt/bar-replay"
BIN="/tmp/bar-replay-arm64"

cd "$(dirname "$0")"

echo "==> Build arm64 (Graviton)…"
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o "$BIN" .
echo "    binary: $(ls -lh "$BIN" | awk '{print $5}')"

echo "==> Kirim binary + index.html + assets/ ke ${HOST} ..."
scp -o StrictHostKeyChecking=accept-new "$BIN" index.html "$HOST:/tmp/"
scp -o StrictHostKeyChecking=accept-new -r assets "$HOST:/tmp/luna-assets"

echo "==> Pasang & restart service…"
ssh "$HOST" 'bash -s' <<REMOTE
set -e
sudo mv /tmp/bar-replay-arm64 $REMOTE_DIR/bar-replay
sudo mv /tmp/index.html $REMOTE_DIR/
sudo rm -rf $REMOTE_DIR/assets
sudo mv /tmp/luna-assets $REMOTE_DIR/assets
sudo chmod +x $REMOTE_DIR/bar-replay
sudo systemctl restart bar-replay
sleep 1
echo -n "    status: "; sudo systemctl is-active bar-replay
REMOTE

rm -f "$BIN"
# URL publik lewat nginx + TLS (reverse proxy ke app di :8765).
echo "==> Selesai -> https://lunatrade.domudame.com"
