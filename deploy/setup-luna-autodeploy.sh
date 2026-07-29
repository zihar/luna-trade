#!/usr/bin/env bash
# Setup auto-deploy pull-based Luna Trade di EC2. Jalankan: sudo bash setup-luna-autodeploy.sh
#
# Repo PRIVATE → fetch lewat SSH deploy key read-only di /root/.ssh/luna_deploy (dipasang di luar
# skrip ini; lihat catatan di deploy/luna-deploy.sh soal pengalihan ke ssh.github.com:443).
# Idempotent & re-runnable: clone/sinkron repo, pasang timer + unit, build perdana.
#
# Setelah ini, go-live BUKAN `git push origin main` (2026-07-29). Yang di-deploy adalah ref
# `release`, dan yang memindahkannya cuma workflow Release di GitHub (Actions → Release → Run
# workflow). EC2 cek origin/release tiap 1 menit lalu build arm64 + restart bar-replay.
#
# Numpang di instance yang sama dengan forex-alertd. Unit dinamai luna-deploy.* (beda
# dari forex-deploy.*) → dua auto-deploy hidup berdampingan. /etc/bar-replay.env (token +
# basic-auth) TIDAK disentuh oleh setup ini maupun deploy harian.
set -euo pipefail

RUNTIME=/opt/bar-replay
REPO="$RUNTIME/repo"
REPO_URL="git@github.com:zihar/luna-trade.git"
BRANCH=release   # ref yang di-deploy — samakan dengan BRANCH di luna-deploy.sh

[ "$(id -u)" -eq 0 ] || { echo "Jalankan dengan sudo/root."; exit 1; }

# Tool dasar.
if ! command -v git >/dev/null || ! command -v curl >/dev/null; then
	apt-get update -qq
	apt-get install -y -qq git curl
fi

# Go: dipakai bareng alertd, sudah terpasang di /usr/local/go. Guard saja.
[ -x /usr/local/go/bin/go ] || { echo "ERROR: /usr/local/go/bin/go tak ada (harusnya terpasang dari alertd)."; exit 1; }

mkdir -p "$RUNTIME"

# 1) Clone repo kalau belum ada.
#
# TANPA `--branch "$BRANCH"`: `release` bisa belum ada (sebelum rilis pertama) dan clone-nya akan
# gagal. Clone default lalu sinkronkan di bawah.
#
# Remote pada repo yang SUDAH ada sengaja TIDAK ditimpa. Instance yang jalan sekarang memakai remote
# SSH + deploy key; menimpanya dengan nilai di skrip ini (mis. kalau suatu saat berbeda) akan
# mematikan fetch di semua tick berikutnya — dan skrip ini adalah jalur pemulihan, jadi ia tak boleh
# jadi cara merusak.
if [ ! -d "$REPO/.git" ]; then
	git clone "$REPO_URL" "$REPO"
fi

if git -C "$REPO" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
	git -C "$REPO" fetch --quiet origin "$BRANCH"
	git -C "$REPO" reset --hard "origin/$BRANCH"
else
	echo "CATATAN: origin/$BRANCH belum ada — repo dibiarkan di default branch."
	echo "         Jalankan workflow Release di GitHub dulu; timer akan diam sampai ref itu lahir."
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
