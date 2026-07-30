# Keep drawing mode — desain

Tanggal: 2026-07-31 · Status: disetujui, siap diimplementasi

Item **T1.2** di `docs/drawing-tools-gap-plan.md` (Tier 1). Pasangan dari measure tool (T1.1) yang
baru selesai — keduanya "workflow feature", bukan tool baru.

## Masalah

Setiap tool gambar di-**disarm** begitu objeknya jadi (`disarmIcons()` di `onDrawEnd`,
`js/draw-tools.js`). Menggambar lima zona support/resistance = lima kali bolak-balik ke rail.
Itu pembeda "cepat vs lambat" yang disebut riset di `docs/drawing-tools-gap-plan.md`, bukan soal
jumlah tool.

## Perilaku TradingView yang ditiru

Diverifikasi dari dokumentasi & panduan TradingView (bukan tebakan):

- Fiturnya **satu tombol toggle** di toolbar gambar, ikon **pensil + gembok**, bernama
  *"Stay in Drawing Mode"*. Klik = nyala, klik lagi = mati; ia tetap aktif sampai dimatikan.
- Contoh pemakaian yang TV sendiri pakai: menaruh **beberapa vertical line** tanpa mengklik
  tool-nya berulang kali.
- `Ctrl`/`⌘` di TV **bukan** milik fitur ini — modifier itu untuk toggle **magnet sementara**
  saat menggambar. Karena itu rancangan ini **tidak** memakai Ctrl-klik, dan Ctrl tetap bebas
  untuk magnet sementara bila kelak dikerjakan.

Sumber: <https://www.tradingview.com/chart/TSLA/qw8dRAeQ-TradingView-Masterclass-How-To-Use-Drawing-Tools/> ·
<https://www.tradingview.com/support/solutions/43000762939-my-drawing-tool-keeps-placing-new-drawings-every-time-i-click-on-the-chart/> ·
<https://www.tradingview.com/charting-library-docs/latest/getting_started/Shortcuts/>

## Keputusan desain

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Aktivasi | Satu tombol toggle di rail (ikon pensil+gembok), tanpa hotkey | Sama dengan TV; TV pun tak punya hotkey untuk ini |
| Default | **Mati** | Sama dengan TV, dan tak mengubah arti 253 test yang sudah ada |
| Persistensi | `localStorage br_keepdraw` (pola `br_magnet`) | TV mengingat statusnya antar-sesi |
| Posisi tombol | Rail bawah, antara magnet dan hide-all | Urutan TV: magnet → stay-in-drawing → lock → hide → remove |
| Kapan rearm | Hanya saat objek **selesai** | Batal (Esc/klik kanan) berarti "aku tak mau objek ini", bukan "beri aku satu lagi" |
| `measure` | Dikecualikan | Objeknya justru dibuang oleh mousedown berikutnya (ephemeral) → rearm membuat gestur berikutnya tak terduga |
| Instant-drop H/V | Ikut, tapi rearm-nya **non-instant** | Rearm ber-`instant` akan menjatuhkan garis lagi di kursor yang sama, seketika, tanpa henti |

## Arsitektur

Frontend saja; tak ada perubahan Go, endpoint, atau skema DB.

### Berkas yang disentuh

| File | Perubahan |
|---|---|
| `js/draw-tools.js` | state `keepDrawOn` + ingatan `lastDrawTool` + `rearmDraw()`; `createDraw()` mencatat tool & membatalkan gambar in-progress yang telantar; `onDrawEnd` & cabang instant-drop memanggil `rearmDraw()` |
| `js/draw-rail.js` | tombol `#keepDrawBtn` (pola `magBtn`), disisipkan antara magnet & hide-all |
| `tests/smoke/keep-drawing.spec.js` | **baru** |
| `docs/drawing-tools-gap-plan.md`, `tests/README.md` | catatan status & jebakan |

### Mekanisme

```
createDraw(name, btn, extra, instant)
  ├─ lastDrawTool = {name, btn}          // siapa yang harus di-rearm nanti
  ├─ if(inProgressId) cancelInProgressDraw()   // buang overlay telantar (lihat di bawah)
  └─ … jalur yang sudah ada …

onDrawEnd (objek jadi)            → rearmDraw()
cabang instant-drop (H/V selesai) → rearmDraw()
cancelInProgressDraw()            → TIDAK rearm
```

```js
// Rearm dijadwalkan ASYNC (setTimeout 0), bukan langsung: onDrawEnd masih berada di dalam
// dispatch event klinecharts untuk overlay yang baru selesai. Membuat overlay baru di detik itu
// mengacak state internalnya (jalur yang sama yang membuat kita menulis titik in-progress sendiri
// di onDrawing, lihat delHooks).
function rearmDraw(){
  if(!keepDrawOn || !lastDrawTool) return;
  const t=lastDrawTool;
  if(t.name==='measure') return;                 // ephemeral: dibuang mousedown berikutnya
  setTimeout(()=>{ if(keepDrawOn && !inProgressId) createDraw(t.name, t.btn); }, 0);
}
```

Dua guard di dalam callback dibutuhkan, bukan hiasan: pengguna bisa mematikan toggle atau meng-arm
tool lain dalam jeda satu tick itu.

**Rearm selalu non-instant.** `createDraw(t.name, t.btn)` dipanggil **tanpa** argumen `instant`, jadi
untuk `horizontalStraightLine`/`verticalStraightLine` tool hanya kembali *armed*: garis berikutnya
jatuh saat pengguna mengklik, bukan seketika di posisi kursor yang sama. Kalau `instant` diteruskan,
tiap rearm akan langsung menjatuhkan garis lagi di tempat yang sama — rantai tanpa henti.

### Perbaikan kecil yang ikut: overlay in-progress telantar

`createDraw()` sekarang tak pernah membersihkan gambar yang sedang berjalan. Meng-arm tool A lalu
tool B tanpa menggambar meninggalkan overlay A tanpa titik di `drawIds`. Sebelum keep-drawing itu
jarang terjadi; dengan keep-drawing, "tool selalu armed" membuatnya jalur biasa (mis. `Alt+H` lalu
`Alt+H` lagi). Karena itu `createDraw()` memanggil `cancelInProgressDraw()` lebih dulu bila ada
`inProgressId`. Ini perbaikan pada kode yang memang sedang kita sentuh, bukan refactor liar.

### Tombol

Pola `magBtn` (`js/draw-rail.js`) diikuti persis: elemen `button.dtool`, kelas `armed` saat nyala,
`title` bahasa Inggris, status ditulis ke `localStorage`. Ikon pensil+gembok (stroke `currentColor`,
grid 24) supaya sekeluarga dengan ikon rail lain.

```js
const KEEPDRAW_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">…</svg>';
_kd.title='Stay in drawing mode: keep the tool active after each drawing (on/off)';
```

## Konsekuensi yang diterima & dicatat

- **Analytics.** Tiap objek hasil rearm tetap mengirim `track('draw',{tool})` — memang satu objek
  digambar, jadi angkanya tak jadi bohong.
- **`text` & `callout`** membuka editor teks inline sendiri setelah jadi. Rearm dijadwalkan setelah
  itu, jadi urutannya: isi teks → commit → tool sudah siap untuk objek berikutnya. Klik di chart
  saat editor masih terbuka akan meng-commit editor *dan* memulai objek berikutnya; itu memang arti
  "keep drawing".
- **Esc tak mematikan toggle.** Esc/klik kanan membatalkan objek in-progress dan men-disarm tool
  (jalur `cancelInProgressDraw` yang sudah ada), tapi preferensinya tetap nyala — klik tool
  berikutnya kembali beruntun. Esc = "batalkan yang ini", tombol = "ubah kebiasaan".
- **Ganti cursor mode / TF / instrumen** tetap membatalkan gambar in-progress seperti sekarang;
  toggle tak tersentuh.

## Verifikasi

`tests/smoke/keep-drawing.spec.js` (murah, ikut gerbang PR):

1. **Toggle nyala → dua trendline berturut-turut** tanpa menyentuh rail lagi: setelah objek pertama
   jadi, `inProgressId` kembali terisi dan namanya `trendline`; dua klik lagi → 2 overlay.
2. **Toggle mati (default) → perilaku lama**: `inProgressId == null` setelah objek jadi. Penjaga
   anti-regresi untuk 253 test lain yang mengandalkan itu.
3. **`Alt+H` saat nyala** → garis jatuh **dan** tool kembali armed non-instant: `inProgressId != null`
   dan jumlah overlay tetap 1 (tak ada garis kedua yang jatuh sendiri).
4. **`measure` tak di-rearm**: `Alt+M`, selesaikan 2 klik, `inProgressId == null`.
5. **Status bertahan setelah reload**: nyalakan → reload → tombol masih `armed` & `keepDrawOn` true.
6. **Esc**: saat menggambar objek kedua, Esc membatalkan (`inProgressId == null`) tapi
   `keepDrawOn` tetap true.

Sebelum push: `npx playwright test tests/smoke --project=hermetic`. Karena perubahan menyentuh
`createDraw`/`onDrawEnd` yang dipakai SEMUA tool, `tests/drawing` juga dijalankan sekali sebelum PR
(bukan kebiasaan "smoke saja", tapi di sini murah dibanding menemukannya setelah merge).

## Di luar cakupan (dicatat)

- **Magnet sementara via `Ctrl`/`⌘`** (perilaku TV yang Luna belum punya) — PR kecil sendiri.
- **Lock all drawings** (T1.3) & **Object Tree** — item terpisah di gap plan.
- Menampilkan tombol ini di favorites bar; favorites khusus tool gambar, bukan toggle.
