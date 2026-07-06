# Kontrol Playback Bar Replay di Toolbar

## Latar
Bar bawah `.replaybar` di-`display:none` total. Di dalamnya masih ada `#replayCtrls`
(⏪ ▶/⏸ ⏩ + dropdown Speed) plus date-picker & Load, tapi tak terlihat. Sekarang user
hanya bisa mengendalikan replay lewat shortcut keyboard (←/→/Space). Perlu memunculkan
kembali kontrol playback di samping tombol "⏮ Bar Replay" di toolbar.

## Keputusan
- Set kontrol: **Prev + Play/Pause + Next + Speed** (lengkap seperti bar lama).
- Visibilitas: **hanya saat mode Bar Replay benar-benar aktif** (bukan sekadar pick-mode).

## Rancangan
1. **Markup** — pindahkan (bukan duplikat) `<span id="replayCtrls">…</span>` dari
   `.replaybar` ke `.tfbar`, tepat setelah tombol `#replayPick`. Semua ID
   (`#prevBtn`,`#playBtn`,`#nextBtn`,`#speed`) dipertahankan → seluruh handler JS &
   shortcut keyboard tetap jalan tanpa ubah logika.
2. **Visibilitas** — `#replayCtrls` default `display:none`; tampil saat kelas `.on` ada.
   Di `setReplayUI(on)` tambah `$('#replayCtrls').classList.toggle('on', on)`.
3. **Style** — CSS toolbar-scoped agar tombol ⏪▶⏩ & select Speed pas dengan tinggi/gaya
   `.tfbar`; separator internal pakai `.sep` toolbar. Style `.replaybar` lama dibiarkan.

## Tidak berubah
Logika `play/pause/step`, shortcut ←/→/Space, date-picker + Load (tetap di `.replaybar`
yang tetap hidden, auto-load), mode paper.

## Hasil
Masuk Bar Replay → toolbar: `⏮ Bar Replay(aktif) | ⏪ ▶ ⏩ | Speed [3×]`.
Live/keluar replay → kontrol hilang.
