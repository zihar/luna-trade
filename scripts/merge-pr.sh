#!/usr/bin/env bash
# Merge PR HANYA kalau CI-nya benar-benar hijau & branch-nya tidak ketinggalan dari main.
#
# Kenapa ini ada: branch protection GitHub (dan rulesets) menolak dipasang di repo PRIVATE tanpa
# GitHub Pro — `PUT /branches/main/protection` dan `POST /rulesets` sama-sama balas HTTP 403
# "Upgrade to GitHub Pro or make this repository public". Jadi CI di repo ini bisa memberi tahu,
# tapi platform tak bisa MENAHAN.
#
# Skrip ini bukan penegakan — orang tetap bisa menekan tombol Merge di github.com. Yang ia lakukan
# adalah membuat jalur yang biasa dipakai (CLI, termasuk oleh agent) tak bisa meloloskan PR merah
# secara tak sengaja. Dua hal yang diperiksa, keduanya menggantikan setting yang tak bisa dipasang:
#
#   1. Semua check WAJIB hijau — bukan cuma "tak ada yang merah". Check yang masih pending ditolak,
#      karena "belum tahu" bukan "aman".
#   2. Branch tidak BEHIND main (padanan "Require branches to be up to date"). Ini bukan formalitas:
#      PR #151 & #152 masing-masing hijau di basis berbeda, dan gabungannya di main belum pernah
#      dijalankan siapa pun — dua perubahan yang aman sendiri-sendiri bisa merusak bersama.
#
# Pakai:  scripts/merge-pr.sh <nomor-PR>
set -euo pipefail

pr="${1:-}"
if [ -z "$pr" ]; then echo "pakai: $0 <nomor-PR>" >&2; exit 2; fi

state=$(gh pr view "$pr" --json state,mergeStateStatus,isDraft --jq '"\(.state) \(.mergeStateStatus) \(.isDraft)"')
read -r pr_state merge_state is_draft <<<"$state"

[ "$pr_state" = "OPEN" ] || { echo "PR #$pr statusnya $pr_state — tak ada yang di-merge." >&2; exit 1; }
[ "$is_draft" = "false" ] || { echo "PR #$pr masih draft." >&2; exit 1; }

# Daftar wajib didefinisikan DI SINI, bukan diambil dari GitHub. Sebabnya konkret: tanpa branch
# protection (403 di repo private tanpa Pro) GitHub melaporkan NOL required check, jadi
# `gh pr checks --required` selalu gagal — skrip yang mengandalkannya takkan pernah mau merge apa
# pun, bahkan saat semua hijau. Ini ketemu saat menguji skrip ini pada PR-nya sendiri.
# Kalau nanti branch protection bisa dipasang, samakan daftar ini dengan required check di sana.
WAJIB=("Go — build, vet, test" "E2E gate")

echo "== check PR #$pr"
checks=$(gh pr checks "$pr" --json name,state,bucket 2>/dev/null || echo '[]')
printf '%s' "$checks" | jq -r '.[] | "  \(.bucket=="pass" and true | if . then "✓" else "·" end) \(.name): \(.state)"' 2>/dev/null || true

gagal=0
for nama in "${WAJIB[@]}"; do
  bucket=$(printf '%s' "$checks" | jq -r --arg n "$nama" '[.[] | select(.name==$n)] | if length==0 then "TIDAK-ADA" else (.[0].bucket) end')
  case "$bucket" in
    pass) ;;
    TIDAK-ADA) echo "DITOLAK: check wajib '$nama' belum melapor sama sekali." >&2; gagal=1 ;;
    pending)   echo "DITOLAK: check wajib '$nama' masih berjalan — 'belum tahu' bukan 'aman'." >&2; gagal=1 ;;
    *)         echo "DITOLAK: check wajib '$nama' → $bucket." >&2; gagal=1 ;;
  esac
done

# Check lain (bukan daftar wajib) yang merah juga menahan: kalau sesuatu gagal, jangan dilewati
# hanya karena namanya tak ada di daftar.
lain=$(printf '%s' "$checks" | jq -r '[.[] | select(.bucket=="fail")] | map(.name) | join(", ")')
if [ -n "$lain" ]; then echo "DITOLAK: ada check gagal: $lain" >&2; gagal=1; fi

[ "$gagal" = 0 ] || exit 1

if [ "$merge_state" = "BEHIND" ]; then
  echo
  echo "DITOLAK: branch ketinggalan dari main." >&2
  echo "         CI-nya hijau di basis LAMA; gabungannya dengan main belum pernah diuji." >&2
  echo "         Jalankan dulu:  gh pr update-branch $pr   lalu ulangi setelah CI hijau." >&2
  exit 1
fi
if [ "$merge_state" = "DIRTY" ]; then
  echo; echo "DITOLAK: ada konflik yang harus diselesaikan lebih dulu." >&2; exit 1
fi

echo
echo "== semua check wajib hijau & branch tidak ketinggalan → merge"
gh pr merge "$pr" --merge --delete-branch
