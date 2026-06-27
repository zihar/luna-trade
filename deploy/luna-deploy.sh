#!/usr/bin/env bash
# Auto-deploy pull-based untuk Luna Trade.
# Dipanggil luna-deploy.timer tiap 1 menit (sebagai root) via /opt/bar-replay/luna-deploy.sh.
# Idempotent: hanya build + restart kalau ada commit baru di origin/<BRANCH>.
# Build native arm64 di EC2 (deps di-vendor → tetap offline, tak perlu module fetch).
# TIDAK menyentuh /etc/bar-replay.env (OANDA_TOKEN + basic-auth tetap aman).
set -euo pipefail

RUNTIME=/opt/bar-replay
REPO="$RUNTIME/repo"
BRANCH=main
GO=/usr/local/go/bin/go

export HOME=/root   # GOCACHE/GOMODCACHE default (build cache persisten antar-run)
# Repo public → fetch anonim via HTTPS, tak perlu SSH deploy key.

cd "$REPO"

git fetch --quiet origin "$BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

# Tidak ada commit baru → diam (tick murah, sub-detik).
[ "$LOCAL" = "$REMOTE" ] && exit 0

ts() { date -u +%FT%TZ; }
echo "[$(ts)] deploy: ${LOCAL:0:8} -> ${REMOTE:0:8}"

# FF hard ke remote (deploy target read-only → buang perubahan lokal liar).
git reset --hard "origin/$BRANCH"

# Build ke temp lalu install atomik (binary lama tetap jalan kalau build gagal: set -e).
"$GO" build -mod=vendor -ldflags="-s -w" -o /tmp/luna.new .
install -m 0755 /tmp/luna.new "$RUNTIME/bar-replay"
rm -f /tmp/luna.new

# Sync aset web (yang selama ini di-scp manual): index.html + assets/.
install -m 0644 "$REPO/index.html" "$RUNTIME/index.html"
rm -rf "$RUNTIME/assets"
cp -r "$REPO/assets" "$RUNTIME/assets"

# Sync unit bar-replay kalau berubah (mis. ExecStart/hardening baru) → daemon-reload.
if ! cmp -s "$REPO/deploy/bar-replay.service" /etc/systemd/system/bar-replay.service; then
	install -m 0644 "$REPO/deploy/bar-replay.service" /etc/systemd/system/bar-replay.service
	systemctl daemon-reload
	echo "[$(ts)] unit bar-replay.service diperbarui"
fi

systemctl restart bar-replay

# Self-update skrip ini untuk run berikutnya (mv = atomik → run saat ini aman).
install -m 0755 "$REPO/deploy/luna-deploy.sh" /tmp/luna-deploy.new
mv /tmp/luna-deploy.new "$RUNTIME/luna-deploy.sh"

echo "[$(ts)] deploy OK @ $(git rev-parse --short HEAD) — bar-replay: $(systemctl is-active bar-replay)"
