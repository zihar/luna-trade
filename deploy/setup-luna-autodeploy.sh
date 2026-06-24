#!/usr/bin/env bash
# Setup auto-deploy pull-based Luna Trade di EC2. Jalankan: sudo bash setup-luna-autodeploy.sh
#
# Repo PUBLIC → fetch anonim via HTTPS (tanpa deploy key / kredensial apa pun).
# Idempotent & re-runnable: clone/sinkron repo, pasang timer + unit, build perdana.
#
# Setelah ini, cukup `git push origin main` dari mesinmu; EC2 cek origin/main tiap 1
# menit, build arm64 + restart bar-replay otomatis saat ada commit baru.
#
# Numpang di instance yang sama dengan forex-alertd. Unit dinamai luna-deploy.* (beda
# dari forex-deploy.*) → dua auto-deploy hidup berdampingan. /etc/bar-replay.env (token +
# basic-auth) TIDAK disentuh oleh setup ini maupun deploy harian.
set -euo pipefail

RUNTIME=/opt/bar-replay
REPO="$RUNTIME/repo"
REPO_URL="https://github.com/zihar/luna-trade.git"
BRANCH=main

[ "$(id -u)" -eq 0 ] || { echo "Jalankan dengan sudo/root."; exit 1; }

# Tool dasar.
if ! command -v git >/dev/null || ! command -v curl >/dev/null; then
	apt-get update -qq
	apt-get install -y -qq git curl
fi

# Go: dipakai bareng alertd, sudah terpasang di /usr/local/go. Guard saja.
[ -x /usr/local/go/bin/go ] || { echo "ERROR: /usr/local/go/bin/go tak ada (harusnya terpasang dari alertd)."; exit 1; }

mkdir -p "$RUNTIME"

# 1) Clone repo (atau pastikan remote benar kalau sudah ada).
if [ ! -d "$REPO/.git" ]; then
	git clone --branch "$BRANCH" "$REPO_URL" "$REPO"
else
	git -C "$REPO" remote set-url origin "$REPO_URL"
	git -C "$REPO" fetch --quiet origin "$BRANCH"
	git -C "$REPO" reset --hard "origin/$BRANCH"
fi

# 2) Pasang skrip deploy + unit + timer.
install -m 0755 "$REPO/deploy/luna-deploy.sh"        "$RUNTIME/luna-deploy.sh"
install -m 0644 "$REPO/deploy/luna-deploy.service"   /etc/systemd/system/luna-deploy.service
install -m 0644 "$REPO/deploy/luna-deploy.timer"     /etc/systemd/system/luna-deploy.timer
systemctl daemon-reload
systemctl enable --now luna-deploy.timer

echo
echo "Setup selesai. Timer aktif:"
systemctl list-timers luna-deploy.timer --no-pager || true
echo
echo "Build perdana sekarang (sinkronkan binary + index.html + assets ke commit terbaru):"
"$RUNTIME/luna-deploy.sh" || true
echo
echo "Pantau: journalctl -u luna-deploy -f   |   systemctl is-active bar-replay"
