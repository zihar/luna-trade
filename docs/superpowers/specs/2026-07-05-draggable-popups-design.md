# Spec: Semua popup config bisa di-drag (header grip)

Tanggal: 2026-07-05

## Tujuan

Setiap popup konfigurasi yang melayang di atas chart dapat digeser (drag) oleh pengguna dengan menekan-tahan sebuah pegangan (handle) di bagian atas popup, lalu dilepas di posisi baru.

## Cakupan

Lima popup melayang (`position:fixed`) yang dibangun via `innerHTML`:

1. `objPop` — style objek gambar (Color/Tebal/Gaya + posisi teks) **dan** popup Long/Short Position (keduanya memakai elemen `objPop` yang sama).
2. `fibPop` — editor level Fibonacci.
3. `chartSet` — setting chart (tombol ⚙).
4. `posConfirmEl` — dialog konfirmasi order.
5. `posEditEl` — panel edit posisi (Edit Open Position).

Di luar cakupan (tetap seperti sekarang): toast notifikasi (`index.html:3497`), editor teks inline `text-editor` (`index.html:3179`), tombol "+ Add text" (`addTextBtn`), menu user (`user-pop`).

## Pegangan drag (handle)

Dua kasus:

- **Popup tanpa header** (`objPop`, `fibPop`, `chartSet`, `posConfirmEl`): tambah bilah grip tipis full-width di atas isi popup. Markup: konstanta `GRIP = '<div class="pp-grip"></div>'` yang **di-prepend** ke setiap assignment `innerHTML` popup tersebut. Grip menampilkan indikator titik (mis. `⠿` via CSS `::before`), `cursor:grab`.
- **Popup dengan header** (`posEditEl`): pakai header yang sudah ada `.pe-head` sebagai handle (tidak menambah grip). Tombol ✕ (`#peClose`) di dalam header tetap berfungsi sebagai tombol, bukan memicu drag.

## Mekanisme

Satu helper reusable, dipanggil sekali per popup saat elemennya dibuat:

```
makeDraggable(el, handleSel)
```

Perilaku:

- Memasang **satu** listener `mousedown` pada `el` sendiri (delegasi). Karena listener menempel di elemen — bukan pada child yang diganti — ia tahan terhadap rebuild `innerHTML`. Setiap template `innerHTML` cukup menyertakan grip/handle-nya.
- Drag dimulai hanya bila:
  - `e.target.closest(handleSel)` cocok (grip atau `.pe-head`), **dan**
  - target bukan kontrol interaktif: `e.target.closest('button,input,select,textarea,label,a')` bernilai null. (Mencegah drag saat menekan tombol ✕ di header, atau kontrol lain yang kebetulan di handle.)
- Saat drag mulai: catat offset `(startX - el.offsetLeft, startY - el.offsetTop)`, pasang listener `mousemove`/`mouseup` di `window`, set `el` ke state dragging (mis. `cursor:grabbing`), dan `e.preventDefault()` untuk mencegah seleksi teks.
- `mousemove`: hitung `left = clientX - offsetX`, `top = clientY - offsetY`, lalu **clamp** ke viewport: `left ∈ [0, innerWidth - el.offsetWidth]`, `top ∈ [0, innerHeight - el.offsetHeight]`. Terapkan ke `el.style.left/top`.
- `mouseup`: lepas listener `mousemove`/`mouseup`, buang state dragging.

Pemanggilan (handle per popup):

| Popup | handleSel |
|---|---|
| `objPop` | `.pp-grip` |
| `fibPop` | `.pp-grip` |
| `chartSet` | `.pp-grip` |
| `posConfirmEl` | `.pp-grip` |
| `posEditEl` | `.pe-head` |

## Prepend grip

Sisipkan `GRIP` di awal string `innerHTML` pada titik berikut (empat popup tanpa header):

- `posConfirmEl.innerHTML` (`index.html:2383`)
- `objPop.innerHTML` — cabang `showObjPopup` (`index.html:3947`)
- `objPop.innerHTML` — cabang `showPosPopup` (`index.html:3968`)
- `fibPop.innerHTML` (`index.html:3992`)
- `chartSet.innerHTML` (`index.html:4042`)

## Persistensi

Tidak ada. Fungsi show tiap popup tetap menimpa `left/top` (buka di titik kursor/objek + clamp) seperti sekarang. Geseran hanya berlaku selama popup terbuka; buka berikutnya kembali ke titik kursor.

## Interaksi dengan perilaku lain

- Handler "klik di luar untuk menutup" (mousedown capture, cek `!el.contains(e.target)`) tidak terpengaruh: grip/handle ada di dalam popup → `contains` true → popup tak menutup saat mulai drag.
- Klik kontrol (tombol/slider/warna/chip) tetap normal karena drag hanya dari handle & dikecualikan untuk elemen interaktif.

## CSS

- `.pp-grip`: tinggi ~14–16px, full-width relatif isi popup, garis pemisah bawah tipis (`border-bottom:1px solid var(--border)`), indikator titik di tengah (`⠿` warna `var(--muted)`), `cursor:grab`, `user-select:none`. Margin diatur agar rapat ke tepi atas popup meski popup punya padding (mis. negative margin sebesar padding popup lalu padding sendiri).
- `.pe-head`: tambah `cursor:grab` dan `user-select:none` (tanpa mengubah layout). Pastikan `#peClose` tetap `cursor:pointer`.
- State dragging (opsional, mis. class `.dragging` pada `el`): `cursor:grabbing`.

## Non-goals (YAGNI)

- Snap ke tepi / magnetik.
- Resize popup.
- Mengingat posisi antar buka (persistensi).
- Drag popup non-config (toast, editor teks inline, menu user).

## Verifikasi

- Tiap dari 5 popup: buka, drag lewat handle, lepas → popup pindah & berhenti di posisi lepas; tak keluar viewport walau di-drag ke pojok.
- Klik kontrol di dalam popup (warna, chip, slider, tombol, checkbox) tetap berfungsi; tidak memicu drag.
- Tombol ✕ pada `posEditEl` menutup panel, bukan memulai drag.
- Popup tidak menutup saat mulai drag dari handle.
- Buka-tutup-buka lagi → muncul kembali di titik kursor/objek (tidak lengket).
- fibPop/objPop/chartSet yang membangun ulang `innerHTML` saat interaksi (mis. tambah/hapus level fib, ganti antar objek) tetap bisa di-drag setelah rebuild.
