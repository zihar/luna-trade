#!/usr/bin/env bash
# Deploy/update Luna Trade ke instance forex-alertd (numpang, tanpa Docker).
#
# FALLBACK MANUAL. Jalur deploy utama sekarang AUTO-PULL: push ke `main` → EC2
# build + restart sendiri dalam <=1 menit (lihat deploy/luna-deploy.* & DEPLOY-NOTES.md).
# Skrip push-based ini dipakai untuk emergency/offline atau tes binary tanpa commit.
# CATATAN: kalau luna-deploy.timer aktif, hasil scp manual akan DITIMPA kembali ke
# versi `main` dalam <=1 menit selama isinya beda dari yang sudah di-commit.
#
# Build binary statis arm64 → scp ke instance → restart systemd service.
# Hanya update binary + index.html + assets/ + css/ + js/; service unit & /etc/bar-replay.env
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
# -mod=vendor: deps (modernc.org/sqlite, pure-Go) di-vendor → build offline, no CGO.
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -mod=vendor -ldflags="-s -w" -o "$BIN" .
echo "    binary: $(ls -lh "$BIN" | awk '{print $5}')"

echo "==> Kirim binary + index.html + assets/ + css/ + js/ ke ${HOST} ..."
scp -o StrictHostKeyChecking=accept-new "$BIN" index.html "$HOST:/tmp/"
scp -o StrictHostKeyChecking=accept-new -r assets "$HOST:/tmp/luna-assets"
scp -o StrictHostKeyChecking=accept-new -r css "$HOST:/tmp/luna-css"
# js/ = modul JS Fase 2. Guard: skrip ini juga dipakai saat folder belum ada (set -e →
# scp folder tak ada = deploy gagal di tengah, binary sudah terkirim tapi belum terpasang).
HAS_JS=0
if [ -d js ]; then
	HAS_JS=1
	ssh "$HOST" 'rm -rf /tmp/luna-js'   # scp -r ke path yang sudah ada bikin /tmp/luna-js/js
	scp -o StrictHostKeyChecking=accept-new -r js "$HOST:/tmp/luna-js"
fi

echo "==> Pasang & restart service…"
ssh "$HOST" 'bash -s' <<REMOTE
set -e
sudo mv /tmp/bar-replay-arm64 $REMOTE_DIR/bar-replay
# Aset dulu, index.html TERAKHIR — ia menunjuk ke semua yang lain (50 <script src> + 11 <link>),
# jadi memasangnya duluan membuka jendela di mana halaman baru meminta aset yang belum ada.
sudo rm -rf $REMOTE_DIR/assets
sudo mv /tmp/luna-assets $REMOTE_DIR/assets
sudo rm -rf $REMOTE_DIR/css
sudo mv /tmp/luna-css $REMOTE_DIR/css
if [ "$HAS_JS" = 1 ]; then
	sudo rm -rf $REMOTE_DIR/js
	sudo mv /tmp/luna-js $REMOTE_DIR/js
fi
sudo mv /tmp/index.html $REMOTE_DIR/
sudo chmod +x $REMOTE_DIR/bar-replay
sudo systemctl restart bar-replay
sleep 1
echo -n "    status: "; sudo systemctl is-active bar-replay
REMOTE

rm -f "$BIN"
# URL publik lewat nginx + TLS (reverse proxy ke app di :8765).
echo "==> Selesai -> https://lunatrade.domudame.com"
