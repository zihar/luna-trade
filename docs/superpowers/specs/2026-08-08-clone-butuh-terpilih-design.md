# Clone hanya untuk objek yang TERPILIH (koreksi #175)

Tanggal: 2026-08-08 · Status: disetujui, siap dikerjakan

Menyelaraskan gestur clone dengan dokumentasi TradingView yang baru diverifikasi.

## Temuan

Verifikasi dokumentasi TV (dipicu pertanyaan tentang magnet + Ctrl) memunculkan satu syarat yang
tak ikut terpasang di PR #175:

> "To make a copy of drawing, **select the item that should be cloned**, hold *Ctrl/Command* and
> then drag the figure to the place you need."
> — [How to clone drawings](https://www.tradingview.com/support/solutions/43000537251-how-to-clone-drawings/)

Di Luna, `Ctrl`+seret badan objek **apa pun** meng-clone, terpilih atau tidak.

## Kenapa syarat itu penting

Bukan soal kesetiaan pada TV. `Ctrl` sekarang punya dua tugas — clone (PR #175) dan magnet
sementara (PR #176) — dan magnet sementara berarti pengguna **menahan Ctrl untuk waktu yang lama**
sambil menggerakkan kursor di atas chart. Tanpa syarat "terpilih", menyentuh badan sebuah objek
selama itu meninggalkan salinan yang tak diminta.

Status terpilih adalah pemisah yang murah dan sudah ada (`selectedId`), dan alur normal tak
terganggu: objek yang **baru digambar sudah terpilih otomatis**, jadi "gambar lalu gandakan" tetap
satu gerakan.

Catatan jujur tentang cakupan manfaatnya: menggeser BADAN objek di Luna memang tak pernah memakai
magnet (cabang translasi hanya menggeser semua titik sejauh delta yang sama), jadi syarat ini
**tidak** membuka kemampuan baru "geser badan + magnet". Manfaatnya murni mencegah clone tak
sengaja — itu saja, dan itu cukup.

## Perubahan

Satu ekspresi di `js/draw-tools.js` `onPressedMoveStart`:

```
cloneArmed = !!(cloneModHeld && o && !o.lock && selectedId===o.id);
```

## Verifikasi

Dua test di `tests/drawing/81-clone-drag.spec.js`:

1. Objek **belum terpilih** (setelah `Escape`) + Ctrl+seret badan → tetap **1** objek, dan objeknya
   tetap **bergeser** (drag biasa tak boleh ikut mati).
2. Objek **dipilih ulang lewat klik** → Ctrl+seret badan meng-clone lagi.

Lima test clone yang sudah ada tetap berlaku tanpa perubahan: objek yang baru digambar sudah
terpilih, jadi jalur utamanya tak berubah.
