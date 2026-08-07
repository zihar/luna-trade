# Ctrl/⌘ + drag objek = clone (T1.5 / A1)

Tanggal: 2026-08-07 · Status: disetujui, siap dikerjakan

Menahan `Ctrl` (Windows/Linux) atau `⌘` (Mac) lalu menyeret **badan** objek gambar meninggalkan
salinan di posisi asal — yang bergerak adalah objek yang diseret. Perilaku TradingView.

## Keputusan

| Pertanyaan | Keputusan | Alasan |
|---|---|---|
| Modifier | `ctrlKey` **atau** `metaKey` | Ctrl di Windows/Linux, ⌘ di Mac (jalur yang dianjurkan di Mac) |
| Kapan salinan dibuat | pada **gerakan pertama**, bukan `onPressedMoveStart` | kalau move-start ikut menyala pada mousedown tanpa gerak, tekan-lepas biasa akan meninggalkan salinan hantu di tempat yang sama |
| Yang bergerak | objek **asli**; salinan diam di posisi asal | tak perlu mengalihkan target drag di tengah gestur — efek visualnya identik dengan TV |
| Handle titik + modifier | **tidak** clone, tetap mengedit titik | di TV clone adalah operasi seluruh objek; membajak drag-handle menghilangkan cara mengedit ujung |
| Objek terkunci | tak bisa di-clone | konsekuensi wajar: objek terkunci memang tak bisa diseret |
| Warisan `lock` | salinan tak terkunci | sumbernya pasti tak terkunci, jadi tak ada yang bisa diwarisi |
| Yang ikut tersalin | `points`, `name`, gaya per objek (`objStyle[id]`), teks (`extendData`) | tanpa gaya & teks, "salinan" bukan salinan |

## Jebakan macOS

`Ctrl`+klik di Mac memicu `contextmenu`, dan handler `#chart` (`js/context-menu.js`) membuka modal
Style bila `hoverId` ada — jadi Ctrl+drag di Mac memunculkan modal di tengah gestur.

Penanganan: handler `contextmenu` mengabaikan event yang membawa `ctrlKey` **saat kursor di atas
objek**. Konsekuensi yang diterima: klik-kanan sambil sengaja menahan Ctrl tak lagi membuka modal
objek. Klik kanan biasa tak tersentuh, dan di Mac `⌘` bebas dari masalah ini.

## Arsitektur

Modul baru **`js/draw-clone.js`** — `cloneOverlay(id)` (satu fungsi murni-efek: baca objek, buat
overlay baru dgn points/styles/extendData yang sama, daftarkan ke `drawIds`, salin `objStyle`).
Dipakai `onPressedMoving` di `js/draw-tools.js` lewat satu gerbang kecil.

State gestur (`cloneArmed`, `cloneDone`) hidup di sisi `draw-tools.js` bersama `dragBase`, karena
ia bagian dari daur hidup drag yang sama dan direset di `onPressedMoveEnd`.

### Titik sentuh

| Berkas | Perubahan |
|---|---|
| `js/draw-clone.js` (baru) | `cloneOverlay(id)` |
| `js/draw-tools.js` `onPressedMoveStart` | catat modifier saat gestur mulai (`cloneArmed`) |
| `js/draw-tools.js` `onPressedMoving` | cabang translasi badan: gerakan pertama + `cloneArmed` → `cloneOverlay` sekali |
| `js/draw-tools.js` `onPressedMoveEnd` | reset state gestur |
| `js/context-menu.js` | abaikan `contextmenu` ber-`ctrlKey` saat di atas objek |
| `tests/smoke/boot-integrity.spec.js` | entri `SENTINEL` untuk modul baru |

## Verifikasi

`tests/drawing/81-clone-drag.spec.js`:

1. Ctrl+drag badan trendline → jadi **2** objek; salinan diam persis di posisi asal, aslinya pindah.
2. ⌘+drag → sama (modifier alternatif benar-benar terbaca).
3. Tanpa modifier → tetap **1** objek (regresi jalur drag biasa).
4. Ctrl+drag pada **handle titik** → tetap 1 objek, titiknya yang bergerak.
5. Salinan mewarisi **gaya** (warna) dan **teks**.
6. Objek **terkunci** → tak ter-clone dan tak bergerak.
7. **Undo** setelah clone → kembali 1 objek.

## Di luar cakupan

- `Ctrl+C` / `Ctrl+V` (A3) — butuh state clipboard + keputusan "paste di mana". PR sendiri.
- Tombol Duplicate di modal Style — pintu masuk kedua; belum diminta.
