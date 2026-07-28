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
# Repo PRIVATE → fetch lewat SSH deploy key read-only di /root/.ssh/luna_deploy.
# github.com dialihkan ke ssh.github.com:443 lewat /root/.ssh/config (2026-07-28): SSH port 22 dari
# instance ini intermiten — terukur 4 tick gagal/24 jam dengan "connect to host github.com port 22:
# Connection timed out". Tiap kegagalan menunda go-live ~2 menit (menunggu timeout TCP), dan kalau
# egress:22 mati total, deploy berhenti SENYAP (binary lama tetap jalan, site membeku diam-diam).
# Kalau fetch tiba-tiba gagal lagi: cek `sudo ssh -T git@github.com` di instance, dan rollback ada
# di /root/.ssh/config.bak-* (HostName github.com, tanpa Port).

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

# Sync aset web (yang selama ini di-scp manual): assets/ + css/ + js/, LALU index.html.
#
# URUTANNYA MENGIKAT: index.html dipasang TERAKHIR. Ia satu-satunya file yang menunjuk ke semua
# yang lain (50 tag <script src> + 11 <link> setelah pemecahan Fase 1 & 2), jadi memasangnya
# duluan membuka jendela di mana halaman baru meminta aset yang belum ada → 404 senyap. Server
# ini serve dari disk dengan no-store, jadi jendela sekecil apa pun benar-benar bisa terkena
# request. Kebalikannya (aset baru + index.html lama) tak berbahaya: aset ekstra cuma tak dipakai.
#
# css/ (Fase 1) & js/ (Fase 2) WAJIB ikut — kalau tidak, /css/*.css & /js/*.js 404 dan aplikasi
# separuh mati. Guard [ -d ] pada js/ karena skrip ini pernah mendarat sebelum file js/ pertama
# lahir: skrip men-self-update di AKHIR run, jadi yang jalan pada satu tick adalah salinan dari run
# SEBELUMNYA — memperbaiki sync di commit yang sama dengan file barunya tidak menolong (rekaman:
# PR #113 → prod tanpa styling, docs/superpowers/specs/2026-07-27-split-index-js-phase2-design.md).
#
# sync_dir memakai tukar-nama, bukan hapus-lalu-salin: `rm -rf` + `cp -r` membuat foldernya HILANG
# selama penyalinan (untuk js/ = 50 file, itu jendela puluhan milidetik dengan seluruh aplikasi
# 404). Dengan menyalin ke .new lalu dua kali mv, jendelanya tinggal jeda antar-mv.
sync_dir() {
	local name="$1"
	[ -d "$REPO/$name" ] || return 0
	rm -rf "$RUNTIME/$name.new" "$RUNTIME/$name.old"
	cp -r "$REPO/$name" "$RUNTIME/$name.new"
	# `if`, bukan `[ ... ] && mv`: di bawah `set -e`, test yang gagal (folder belum pernah ada —
	# sinkron pertama di instance baru) membuat seluruh skrip keluar.
	if [ -d "$RUNTIME/$name" ]; then mv "$RUNTIME/$name" "$RUNTIME/$name.old"; fi
	mv "$RUNTIME/$name.new" "$RUNTIME/$name"
	rm -rf "$RUNTIME/$name.old"
}
sync_dir assets
sync_dir css
sync_dir js
install -m 0644 "$REPO/index.html" "$RUNTIME/index.html"   # TERAKHIR — lihat catatan urutan di atas

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
