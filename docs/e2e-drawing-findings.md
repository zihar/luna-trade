# Temuan ronde pertama E2E drawing

Tanggal: 2026-07-25 · Suite: `npm test` (163 test, project `hermetic`)
Hasil ronde pertama: **112 lolos · 51 gagal** — semua kegagalan adalah temuan, bukan harness
yang rusak.

**Update 2026-07-26 (setelah anchor sub-bar / Temuan 1):** suite naik jadi
**166 test hermetik · 160 lolos · 6 gagal** (+2 test `@integration` yang butuh server Go asli
di `:8765`, tak tersedia di lingkungan ini, di luar jalur hermetik).

**Update 2026-07-26 (setelah penawar klik-tertelan / Temuan 2):** **166 test hermetik ·
163 lolos · 3 gagal**. Suite juga jadi deterministik: kelompok klik cepat tak lagi bergantung
beban mesin (lihat catatan flaky di Temuan 2).

**Update 2026-07-26 (setelah gerbang `ptrOverChart` / Temuan 4):** **166 test hermetik ·
164 lolos · 2 gagal**. Sisa merah tinggal **satu** kelompok yang masih sengaja dibiarkan:
Temuan 3 (keterjangkauan `simpleAnnotation`/`simpleTag`, 2 test). Tak ada regresi di luar itu.

**Update 2026-07-26 (spec drag ditambahkan / Temuan 6):** suite jadi **204 test hermetik ·
169 lolos · 35 gagal** (terukur, bukan hitungan di atas kertas). Tambahan 38 test
(`31-drag-precision.spec.js`) menutup titik buta drag-setelah-jadi; **33** di antaranya sengaja
merah dan itulah isi Temuan 6 (implementasinya belum dikerjakan — urutan wajib "test dulu, baru
fix"). Dua merah sisanya tetap Temuan 3.

**Update 2026-07-27 (lapis presisi drag / Temuan 6 SELESAI):** **204 test hermetik · 202 lolos ·
2 gagal**. Sisa merah tinggal Temuan 3.

**Update 2026-07-27 (Temuan 3 ditutup dengan menarik 2 tool):** **199 test hermetik · 199 lolos ·
0 gagal** — suite hijau seluruhnya untuk pertama kalinya sejak ronde pertama (112/163). Jumlah
test turun karena test milik `simpleAnnotation`/`simpleTag` ikut hilang bersama tool-nya, dan naik
satu karena penjaga baru "tool yang ditarik" di `50-rail.spec.js`.

Sekaligus dibetulkan: **status kartu galeri** dulu memakai aturan sumbu yang beda tipis dari
assertion-nya, sehingga `horizontalRayLine` (Y klik ke-2-nya memang diabaikan) muncul sebagai
3 kartu merah di suite yang hijau. Sekarang keduanya memakai satu predikat (`withinTol`) →
galeri **50 kartu · 0 gagal**.

**Update 2026-07-27 (Temuan 5 SELESAI):** **201 test hermetik · 201 lolos · 0 gagal** (galeri 50
kartu, 0 gagal). Favorite kini disimpan berkualifikasi grup (`shapes:arrow`), jadi shape Arrow bisa
difavoritkan dan tak lagi berubah jadi tombol mode kursor; +2 test (perilaku & migrasi data lama).
**Seluruh temuan ronde pertama (1–6) tertutup.**

Tak ada temuan ronde pertama yang masih terbuka. Backlog terpisah (bukan temuan): gap tool
drawing vs TradingView — `docs/drawing-tools-gap-plan.md`.

Kebijakan spec (disetujui sebelum implementasi): toleransi presisi **≤1px untuk semua tool**,
kecuali tool yang snap-per-bar-nya disengaja & beralasan di kode. Merah di ronde pertama
memang diharapkan; melonggarkan toleransi supaya hijau justru menyembunyikan masalahnya.

---

## Temuan 1 — Menggambar tak mengikuti kursor: 20 dari 24 tool meleset ½ bar — SELESAI

**Status:** diperbaiki 2026-07-25, lihat
`docs/superpowers/specs/2026-07-25-drawing-subbar-anchor-design.md`.
Presisi sub-bar kini default untuk semua tool; snap per-bar disisakan sebagai daftar
pengecualian eksplisit `BAR_ANCHOR` (`index.html`) untuk `verticalStraightLine` dan
`long/shortPosition`.

**Kualifikasi penting — cakupan "SELESAI" di atas hanya untuk jalur MENGGAMBAR (klik/
press-drag saat objek belum jadi), bukan drag SETELAH objek jadi.** Celah itu kini **sudah
teruji dan terukur** — lihat **Temuan 6**; paragraf di bawah adalah dugaan aslinya, yang
ternyata benar. Menggeser titik/badan
objek yang sudah selesai digambar (mis. memilih `rect` yang sudah ada lalu menarik salah
satu titiknya) masih presisi sub-bar **hanya untuk `trendline`** —
`onPressedMoveStart`/`onPressedMoving`/`onPressedMoveEnd` yang menulis ulang titik
dengan presisi cuma terdaftar di registrasi `trendline` (`index.html:945-995`). 20 tool
lain kemungkinan besar masih snap-per-bar saat titik yang sudah jadi di-drag ulang, dan
ini **tak teruji**, bukan sekadar belum diperbaiki — `tests/drawing/30-interaction.spec.js`
(describe "drag") hanya menjalankan kedua test dragnya (drag satu titik, drag badan) atas
`trendline` (`SAMPLES = ['trendline', 'rect', 'horizontalStraightLine']` di file itu dipakai
untuk describe "persist setelah reload", bukan describe "drag"). Celah ini diteruskan
sebagai follow-up, bukan cacat dari perbaikan Temuan 1 itu sendiri (yang scope-nya memang
jalur menggambar). Catatan implementasi untuk siapa pun yang mengerjakan follow-up ini:
`onPressedMoveEnd` yang ADA SEKARANG memanggil `scheduleSaveDraws()` setelah
`refineMagnetPoints`; kalau lapis presisi drag ini diperluas ke tool lain nanti, panggilan
itu wajib dibawa juga, kalau tidak perubahan hasil drag tak akan tersimpan.

**Urutan wajib untuk PR follow-up: tulis dulu test drag untuk tool non-`trendline`,
baru implementasi.** Rencana Task 4 yang menutup celah ini (lihat
`docs/superpowers/plans/2026-07-25-drawing-subbar-anchor.md`) memakai gerbang "kerjakan
hanya bila blok test tertentu merah" — tapi gerbang itu hanya bisa mengamati blok
press-drag SAAT MENGGAMBAR (`20-parity.spec.js:106`), yang memang sudah punya test.
Drag-setelah-jadi untuk tool selain `trendline` tak punya test SAMA SEKALI di
`30-interaction.spec.js`, jadi tak ada blok merah yang bisa dipakai gerbang itu
mendeteksi kapan fitur ini perlu dikerjakan — sebuah gerbang yang menunggu test hijau
tak akan pernah menyala untuk celah yang testnya belum ditulis. Tanpa menuliskan test
drag itu lebih dulu (merah), follow-up berikutnya mewarisi titik buta yang sama persis.

**Gejala terukur.** Klik di sebuah pixel, objek mendarat **3–4px** di sampingnya
(= ½ `barSpace`; pada fixture `barSpace` = 8px). Berlaku untuk `rayLine`, `straightLine`,
`horizontalStraightLine`, `horizontalRayLine`, `priceLine`, `parallelStraightLine`,
`priceChannelLine`, `fib3`, `fibonacciLine`, `rect`, `circle`, `ellipse`, `arrow`,
`arrowMarkUp`, `arrowMarkDown`, `dateRange`, `text`, `callout`, `simpleAnnotation`,
`simpleTag`.

**Yang TIDAK terjadi.** Δparity = **0 di semua tool** — objek tak pernah "loncat" antara
preview dan hasil akhir. Kekhawatiran awal ("harus pas antara preview dan klik ke-2") sudah
aman. Yang bocor satu lapis di bawahnya: **rubber-band-nya sendiri** juga sudah meleset
(Δpreview = Δlanding = 3–4px), jadi preview dan final konsisten — konsisten-konsisten
salah tempat.

**Yang lolos.** `trendline` = **0px** di ketiga metrik. `verticalStraightLine` dan
`long/shortPosition` lolos hanya karena toleransinya sengaja dilonggarkan (½ bar + 1),
sesuai alasan yang tertulis di kode:
- `verticalStraightLine` — penanda waktu harus = waktu candle yang diklik (index.html:590)
- `long/shortPosition` — entry harus mendarat di center candle terpilih (index.html:3408-3412)

**Akar masalah.** klinecharts men-snap titik ke pusat bar. Hanya overlay `trendline` yang
punya penawarnya: hook `onDrawing` (index.html:965) menulis ulang titik in-progress sebagai
`dataIndex` **pecahan**, dan `onDrawEnd` (index.html:3070) meng-commit dengan `fidx` presisi
dari klik. Tool lain menyimpan `timestamp` sub-bar — presisi di data, tapi
`convertToPixel({timestamp})` **men-snap ke bar** saat render (dikonfirmasi komentar
index.html:587), jadi presisinya hilang di layar.

**Kalau mau diperbaiki:** pola penawarnya sudah ada di repo ini. Port pendekatan `trendline`
(anchor `dataIndex` pecahan + `onDrawing` yang menulis ulang titik in-progress) ke overlay
lain. Untuk 9 overlay built-in klinecharts, hook `onDrawing` bisa dipasang lewat
`overrideOverlay`/pendaftaran ulang; keputusan cakupannya ada di tangan kamu.

Test: `tests/drawing/20-parity.spec.js` · angka per tool: `report/gallery.html`

---

## Temuan 2 — Klik cepat menelan klik: menggambar cepat gagal jadi — SELESAI

**Status:** diperbaiki 2026-07-26 lewat `fixClickSwallow()` di `index.html`, dipasang untuk
chart utama dan setiap panel multi-chart (drawing bisa pindah ke panel).

**Gejala terukur.** Dua klik yang berjeda **< ~400ms** membuat klik ke-2 hilang; objek tak
pernah selesai. Jeda minimum yang berhasil terukur antara 350ms dan 400ms. Semua 14 tool
multi-titik terdampak. Setelah fix, pengukuran yang sama
(`10-click-timing.spec.js`) melaporkan **100ms→jadi** — tak ada lagi ambang penelanan.

**Bukan double-click browser.** Listener DOM di `#chart` menerima **dua `click` normal,
`detail=1` keduanya**. Yang menelan adalah lapisan synthetic-event klinecharts.

**Koreksi akar masalah.** Catatan ronde pertama menyebut klinecharts "mendeteksi double-click
**tanpa memeriksa jarak**". Itu **salah**, dan salahnya mengarahkan fix ke tempat yang keliru.
Jarak justru **diperiksa**; yang cacat adalah apa yang terjadi ketika pemeriksaan itu gagal.
Dari `_mouseUpHandler` bundle 9.8.10 (dinamai ulang agar terbaca):

```js
++clickCount;
if (clickTimeoutId !== null && clickCount > 1) {
  if (manhattan(now, firstDown) < 5) fire(dblclick);   // hanya kalau DEKAT
  resetClickWindow();                                  // window ditutup di sini, apa pun hasilnya
} else {
  fire(click);
}
```

Mouseup ke-2 di dalam window 500ms (dibuka mousedown ke-1) **selalu** masuk cabang atas. Bila
jaraknya ≥5px, `dblclick` tak dipancarkan karena jarak — tapi `click` juga tidak, karena cabang
`else` sudah terlewat. Klik itu hilang tanpa event apa pun: bukan "dianggap dobel", melainkan
**jatuh ke celah mati antara dobel dan tunggal**.

Bukti langsung (probe Playwright, jeda 120ms, `trendline`): klik ke-2 berjarak 200px →
`inProgress` tetap `true` (tertelan); klik ke-2 berjarak 2px → objek **selesai** karena
`dblclick` memicu `forceComplete`. Jarak jelas ikut menentukan.

**Fix.** Listener `mousedown` fase **capture** di container chart menutup sendiri window click
klinecharts (`_resetClickTimeout()` milik instance-nya) ketika mousedown itu jelas bukan calon
double-click — yaitu ≥5px dari klik sebelumnya, memakai ambang milik klinecharts sendiri.
Handler mereka lalu melihat window kosong → klik diproses lewat cabang `else` sebagai klik
normal. Double-click asli (<5px) tak tersentuh, jadi "dobel-klik untuk menyelesaikan gambar"
dan "dobel-klik membuka modal Style|Text" tetap hidup.

Kenapa bukan menambal method klinecharts: handler-nya di-`bind` saat `_init` di constructor,
jadi menambal prototype **setelah** init tak berpengaruh sama sekali — sudah dicoba, perilakunya
tak bergerak. Menyentuh state instance dari listener capture adalah satu-satunya jalan dari luar
tanpa mem-vendor & menambal bundle CDN-nya.

**Dampak pengguna.** Menggambar cepat adalah kebiasaan wajar dan mulus di TradingView. Di
sini klik ke-2 hilang tanpa umpan balik; user mengklik lagi dan sering dapat objek di tempat
yang salah.

**Efek susulan.** Saat klik akhirnya masuk, `pendingClicks` sudah desync dengan titik
klinecharts → guard `refine` (index.html:3063) gugur → titik jatuh kembali ke snap-per-bar.
Itu sebabnya 8 tool juga gagal pada assertion presisi di jalur ini, bukan cuma "tak selesai".
Efek susulan ini **ikut hilang** begitu klik tak lagi tertelan: seluruh 14 tool multi-titik
lolos assertion presisi di jalur klik cepat, tanpa menyentuh `pendingClicks` sama sekali.

**Kenapa kelompok ini dulu tampak flaky.** Yang menentukan penelanan adalah jarak waktu
mousedown ke-1 → mouseup ke-2 (window 500ms), bukan angka jeda yang ditulis test. Saat mesin
sibuk, `page.mouse.move` + jeda 120ms melar melewati 500ms → klik lolos & test hijau tanpa
perubahan kode. Itu sebabnya jumlah merah bergeser antar-run (3 merah di run 4-worker vs 13
merah di run 2-worker atas commit yang sama). Bukan test yang goyah, tapi ambang yang
bersinggungan dengan beban mesin — dan sekarang ambangnya tak ada lagi.

Test: `tests/drawing/10-click-timing.spec.js`, `20-parity.spec.js` (describe "klik cepat")

---

## Temuan 3 — `simpleAnnotation` & `simpleTag` tak bisa dijangkau setelah tergambar — SELESAI (ditarik)

**Status:** diselesaikan 2026-07-27 dengan **menarik kedua tool dari rail**, bukan memperbaikinya.

**Akar masalahnya di upstream.** Keduanya overlay **bawaan klinecharts** — di bundle 9.8.10,
definisi keduanya menandai **setiap figure**-nya `ignoreEvent: true` (`simpleAnnotation`: garis
tegak + kepala panah + teks, ketiganya; `simpleTag`: garis horizontalnya, plus label sumbu Y lewat
`createYAxisFigures`), dan tak menyetel `needDefaultPointFigure`. `ignoreEvent` berarti figure itu
dilewati saat hit-test, jadi rantainya: hit-test tak pernah kena → `onMouseEnter` tak jalan →
`hoverId` tetap null → tak bisa dipilih, di-drag, dihapus lewat klik/Delete, atau dibuka
setting-nya. Kombinasi "semua figure `ignoreEvent`" + "tanpa handle default" menandakan keduanya
dirancang sebagai **anotasi programatik** (dipasang oleh kode), bukan objek yang digambar &
disunting pengguna — jadi memakainya sebagai tool gambar memang salah tempat.

**Kenapa ditarik, bukan diperbaiki.** Memperbaikinya bisa: daftarkan ulang sendiri tanpa
`ignoreEvent` (presedennya ada — garis horizontal/vertikal sudah kita override), lalu masuk
`DRAW_DEFAULT` agar modal Style hidup, dan `simpleAnnotation` juga perlu ikut jalur editor teks
inline (tanpa cara mengisi teks, ia tak berguna). Itu satu PR sedang — untuk dua tool yang
**redundan dengan tool yang sudah bekerja penuh**: `simpleTag` ≈ `priceLine` (garis + penanda harga
di sumbu Y), `simpleAnnotation` ≈ `callout` / `arrowMarkUp-Down` (teks berpointer & penanda di bar).
Jadi tak ada fungsi yang benar-benar hilang.

**Cakupan perubahan.** Entri rail dihapus (`DRAW_GROUPS`), keluar dari `PERSIST_DRAW` — dan itu
sekaligus **jalur migrasinya**: `buildDrawsFromArray` memfilter lewat daftar itu, jadi objek lama
yang masih tersimpan di localStorage pengguna berhenti dimuat tanpa kode migrasi. Keluar juga dari
`MAGNET_REFINE_SKIP` dan dari `TOOL_SPEC` (tool-nya tak ada lagi di UI, jadi 2 test "keterjangkauan
objek" yang merah ikut hilang bersama tool-nya). Alasan lengkapnya ditulis di tempat entri rail-nya
dihapus, dan penjaga di `tests/drawing/50-rail.spec.js` (describe "tool yang ditarik") memastikan
keduanya tak diam-diam kembali: menghidupkannya lagi wajib lewat pendaftaran ulang sendiri.

### Isi temuan aslinya

Kedua objek **tak bisa di-hover di titik mana pun** — sudah diprobe di titik-titiknya,
midpoint, pusat & tepi bounding box, dan beberapa offset vertikal. Konsekuensinya: tak bisa
dipilih, tak bisa di-drag, tak bisa dihapus dengan klik/Delete, tak bisa dibuka setting-nya.
Satu-satunya jalan keluar adalah Undo atau menu trash (hapus semua).

Keduanya juga memang tak ada di `DRAW_DEFAULT` (index.html:715) → tak punya panel setting.
Kombinasinya: sekali tergambar, objek itu praktis mati.

Test: `tests/drawing/40-modal-text.spec.js` (describe "keterjangkauan objek")

---

## Temuan 4 — Instant-drop memakai posisi kursor basi — SELESAI

**Status:** diperbaiki 2026-07-26 lewat flag `ptrOverChart` di `index.html`.

`Alt+H` / `Alt+V` menjatuhkan garis di posisi kursor tanpa klik. Niat yang tertulis di kode:
bila kursor **di luar** chart, `instantDropPoint` mengembalikan null → jatuh ke mode gambar
biasa. Tapi `lastPtr` hanya di-update oleh `mousemove` pada `#chart`, jadi ia **tak pernah**
berisi koordinat di luar chart — cek rect di dalam `instantDropPoint` tak pernah bisa gugur.

Akibatnya: menekan `Alt+H` sambil kursor berada di watchlist/header/panel tetap menjatuhkan
garis di posisi terakhir di dalam chart — tanpa diminta, di tempat yang tak dilihat user.
Fallback yang sudah ditulis itu efektif jadi kode mati.

**Fix.** Flag `ptrOverChart` (di-set `mousemove`/`mouseenter` pada `#chart`, di-clear
`mouseleave`) jadi gerbang pertama `instantDropPoint`. Cek rect dipertahankan sebagai lapis
kedua untuk kasus lain (chart menyusut setelah posisi terakhir tercatat).

**Kenapa flag terpisah, bukan `lastPtr` yang dilacak di level document.** Tujuh pemakai
`lastPtr` yang lain (popup setting objek & mini-confirm, panel edit posisi, jaring pengaman
anchor di `onDrawEnd` dan di jalur posisi paper, hit-test badge alert, `overPlaceholder`)
semuanya berjalan saat pointer memang di atas chart dan membutuhkan koordinat yang valid **di
dalam** chart. Melacak `lastPtr` sampai ke luar chart akan membuat dua jaring pengaman anchor
itu menerima koordinat di luar area plot — tepat kelas bug yang mereka cegah ("garis kelempar
ke tepi"). Basi-nya `lastPtr` itu justru desain; yang kurang hanyalah cara mengetahui pointer
sudah keluar.

**Konsekuensi kecil yang diterima:** kalau pointer sudah diam di atas chart sejak sebelum
halaman selesai memuat (belum ada `mousemove`/`mouseenter` sama sekali), `Alt+H` kini jatuh ke
mode gambar biasa — butuh satu klik. Sebelumnya ia menjatuhkan garis di **default** `lastPtr`
(tengah viewport), yaitu posisi yang juga bukan tempat yang user tunjuk. Jadi ini lebih dekat
ke niat, bukan mundur.

Test: `tests/drawing/50-rail.spec.js`

---

## Temuan 6 — Drag SETELAH objek jadi masih snap per-bar (18 tool titik · 15 tool badan) — SELESAI

**Status:** diperbaiki 2026-07-27. `onPressedMoveStart`/`onPressedMoving`/`onPressedMoveEnd`
dipindah dari registrasi `trendline` ke `delHooks()` dengan guard `subBar()` (sejalan dengan
`onDrawing`), `tlDrag` → `dragBase`, dan `scheduleSaveDraws()` ikut dibawa supaya hasil drag
tersimpan. Spec drag: **38/38 hijau**; suite penuh **204 test · 202 lolos · 2 gagal** (sisa =
Temuan 3).

**Satu hal yang tak terduga dan penting.** Memindahkan hook saja belum cukup untuk `rect` &
`fib3`: keduanya mendaftarkan `performEventPressedMove: boxPressedMove` yang menulis ulang 8
titik supaya kotaknya tetap kotak — dan `return true` di `onPressedMoving` (yang memang perlu,
untuk melewati snap bawaan) **ikut melewati pemanggilan hook itu**. Akibatnya menarik satu handle
menulis satu titik lepas → kotaknya rusak, titik mendarat **202px** dari kursor: lebih buruk dari
bug yang sedang diperbaiki. Fixnya memanggil `boxPressedMove` sendiri dari dalam
`onPressedMoving`, dengan `performPoint` presisi (`dataIndex` pecahan) — `writeBox`/`keyOf`
memang sudah menerima anchor pecahan. Pelajaran umumnya: overlay yang punya
`performEventPressedMove` sendiri tak boleh sekadar dilewati; ia harus disuapi titik presisi.

Selain itu, satu kegagalan awal ternyata **testnya yang salah**: `31-drag-precision` mula-mula
menyeret titik TERAKHIR, dan pada `rect`/`fib3` titik terakhir adalah handle **tengah-sisi** yang
secara desain hanya menggeser satu sumbu (terukur Δy 151px — perilaku benar, bukan cacat). Spec
sekarang menyeret **sudut** bbox (`cornerIndex`).

**Verifikasi di server lokal + akun sungguhan:** blok badan turun dari 15 merah (pra-fix) jadi 6,
dan keenamnya **tak reproducible** — test yang sama lolos saat dijalankan sebagai subset kecil,
dan yang gagal selalu assertion boolean (objek gagal di-grab), bukan presisi pixel. Ini masuk
kategori noise mode live yang sudah didokumentasikan di `tests/README.md`; gerbang tetap hermetik.

### Isi temuan aslinya (sebelum perbaikan)

Ini celah yang sebelumnya cuma "diduga & tak teruji" di kualifikasi Temuan 1. Sekarang terukur,
oleh `tests/drawing/31-drag-precision.spec.js` (38 test: 20 drag-titik + 17 drag-badan + 1
penjaga cakupan).

**Angka (2026-07-26).** Hermetik dan server lokal + akun sungguhan memberi hasil **identik**:

| Blok | Lolos | Gagal |
|---|---|---|
| drag titik (20 tool) | 2 (`trendline`, `verticalStraightLine`) | **18** |
| drag badan (17 tool) | 2 (idem) | **15** |

`trendline` lolos karena ia satu-satunya yang punya lapis presisi drag
(`onPressedMoveStart`/`Moving`/`End` di registrasinya). `verticalStraightLine` lolos karena
snap-per-bar-nya memang disengaja (`BAR_ANCHOR`), jadi toleransinya ½ bar + 1.

**Besar kesalahannya deterministik: tepat ½ `barSpace`** (4px pada `barSpace` 8px) untuk drag
titik, dan sebesar pembulatan-per-bar untuk drag badan (terukur 6px pada satu kasus). Angka itu
tak muncul dengan sendirinya — target drag **sengaja** ditaruh di tengah antara dua pusat bar
(`halfBarOffX` untuk titik, Δ "sejumlah bar bulat + ½ bar" untuk badan). Tanpa itu besar
kesalahan tergantung keberuntungan: versi pertama spec ini memakai target apa adanya dan
mengukur Δ 2px, dan blok badannya memberi **set kegagalan yang beda antara fixture & server
nyata** semata karena titik grab-nya berbeda — bukan karena aplikasinya berbeda. Pelajarannya:
untuk menguji snap, target uji harus ditaruh di titik paling tak menguntungkan bagi snap.

**Yang TIDAK diuji, beserta alasannya** (konstanta `DRAG_SKIP`/`BODY_SKIP` di spec, dijaga satu
test agar tak diam-diam bertambah):
- `simpleAnnotation`, `simpleTag` — Temuan 3: tak bisa di-hover sama sekali → tak bisa di-drag.
- `longPosition`, `shortPosition` — drag-nya jalur sendiri (handle SL/TP + panel posisi).
- `arrowMarkUp`, `arrowMarkDown`, `text` — tak punya badan terpisah dari handle titiknya (terukur
  lewat probe: tak ada satu pun pixel hoverable ≥14px dari titik), jadi drag badan == drag titik
  dan sudah tercakup blok titik.

**Rencana perbaikannya sudah tertulis** sebagai Task 4 di
`docs/superpowers/plans/2026-07-25-drawing-subbar-anchor.md`: pindahkan
`onPressedMoveStart`/`onPressedMoving`/`onPressedMoveEnd` dari registrasi `trendline` ke
`delHooks()` dengan guard `subBar()`. Wajib dibawa serta: panggilan `scheduleSaveDraws()` di
`onPressedMoveEnd` — tanpa itu hasil drag tak tersimpan.

Test: `tests/drawing/31-drag-precision.spec.js` · verifikasi live: `--project=live` +
`LUNA_LIVE=1` (lihat `tests/README.md`, wajib `--workers=1`)

---

## Temuan 5 — dua sumber kebenaran untuk nama `arrow` — SELESAI

**Status:** diperbaiki 2026-07-27. Favorite kini disimpan sebagai **`"<groupKey>:<toolName>"`**
(mis. `shapes:arrow`), bukan nama telanjang, dengan migrasi sekali-jalan untuk data lama di
`br_fav_tools`.

**Koreksi bobot temuan.** Catatan ronde pertama menyebut ini "kelas kebersihan kode, bukan
kerusakan" karena "kedua jalur pemakaian sendiri tetap berfungsi". Itu **meremehkan**: yang salah
bukan cuma tooltip. Probe di harness (jeda 2026-07-27) mengukur bahwa mem-favorite **shape Arrow**
menghasilkan tombol favorites bertooltip `Cursor: Arrow (no crosshair)` yang **kliknya mengubah
mode kursor** (`cursorMode` cross→arrow, crosshair mati) dan **tak** meng-arm overlay
(`inProgressId` tetap null). Praktisnya: **shape Arrow tak bisa difavoritkan** — favoritnya diam-diam
jadi tombol ganti mode kursor. Jadi ini bug fungsional kecil, bukan kosmetik.

**Kenapa flyout rail sendiri aman:** ia memanggil `pickTool(g, t, …)` dengan objek grup & tool
langsung dari iterasi, tanpa lookup nama. Yang bocor hanya jalur favorites, karena `buildFavBar()`
me-resolve nama lewat `toolByName`/`groupOfTool` ("yang pertama menang" → varian Cursor).

**Kenapa migrasinya tak ambigu:** bintang favorite **hanya** dirender untuk grup non-cursor
(`if(!g.cursor)` di `openFlyout`), jadi mode kursor tak pernah bisa difavoritkan — nama telanjang
`arrow` yang tersimpan pasti berasal dari shape Arrow, satu-satunya Arrow yang punya bintang.
Migrasi memetakan nama lama ke grup non-cursor pertama yang memuatnya, lalu menulis ulang
`br_fav_tools`; entri yang tak terpetakan lagi (mis. tool yang ditarik) dibuang.

Test: `50-rail.spec.js` describe "favorites" — dua test baru (shape Arrow meng-arm shape & tak
mengubah mode kursor; nama telanjang lama dimigrasi ke kunci ber-grup). Keduanya **diverifikasi
tidak hampa**: dengan resolusi lama dikembalikan, keduanya merah.

### Isi temuan aslinya

## Temuan 5 (kecil) — dua sumber kebenaran untuk nama `arrow`

`arrow` terdaftar di grup **Cursor** ("Arrow (no crosshair)") dan grup **Shapes** ("Arrow").
`toolByName('arrow')` / `groupOfTool('arrow')` (index.html:3532, 3538) mengembalikan varian
**cursor** (yang pertama), sedangkan `OBJ_TITLE`/`OBJ_ICON` (index.html:5550) dibangun dengan
"definisi belakang menang" → varian **shape**.

Efek nyata: mem-favorite shape Arrow menghasilkan tombol favorites bar dengan tooltip
**cursor**. Kedua jalur pemakaian sendiri tetap berfungsi, jadi ini kelas kebersihan kode,
bukan kerusakan.

Test: `tests/drawing/50-rail.spec.js` (describe "tabrakan nama tool") — **lolos**, karena
menegaskan perilaku yang ada sekaligus mendokumentasikan inkonsistensinya.

---

## Yang terbukti sehat (112 lolos)

Bukan sekadar "tak error" — ini yang diperiksa dan benar:

- **Presisi `trendline`** — 0px di parity, preview, dan landing. Satu-satunya tool yang
  benar-benar mengikuti kursor.
- **Drag (`trendline` saja — lihat kualifikasi di Temuan 1)** — geser satu titik: titik itu
  mendarat tepat di kursor (≤1px) dan titik lain tak bergeming. Geser badan: semua titik
  bergeser sama besar (≤1.5px). Kedua test ini (`tests/drawing/30-interaction.spec.js`,
  describe "drag") hanya dijalankan atas `trendline`; 20 tool lain **tak teruji** untuk drag
  setelah objek jadi dan kemungkinan besar masih snap-per-bar di jalur itu.
- **Hapus** — tiga jalur (tombol Delete, eraser-klik, trash di modal) semuanya bersih.
- **Undo/redo** — Ctrl+Z membuang, Ctrl+Y mengembalikan.
- **Hide/show** — menyembunyikan tanpa menghapus (`visible=false`, objek tetap ada).
- **Persist setelah reload** — `trendline`, `rect`, `horizontalStraightLine` kembali di
  **posisi pixel identik** (≤1px), dengan jumlah titik yang benar termasuk hasil ekspansi.
- **ESC** — membatalkan gambar in-progress tanpa menyisakan overlay sampah; pada objek
  terpilih hanya men-deselect, tidak menghapus.
- **Modal Style|Text** — 20 tool: terbuka, tab awal benar (Text untuk objek bisa-teks, Style
  untuk sisanya), ganti warna tersimpan, Delete berfungsi. Posisi dialihkan ke popup posisi.
- **Teks** — editor inline terbuka otomatis untuk `text`/`callout` dan teksnya tersimpan;
  `rect` kosong menerima teks lewat placeholder "+ Add text"; Escape pada `text` kosong
  menghapus objeknya (sesuai desain, diuji eksplisit).
- **Rail** — arm 1-klik, isi flyout tiap grup persis sesuai daftar tool, pilihan tool sticky
  setelah reload, favorites bintang → bar melayang yang bisa arm dan bisa digeser + tersimpan.
- **Shortcut** — 11 tool ber-`sc` (Alt+T/Y/E/H/V/P/F/R/O/A/X) semuanya meng-arm tool yang
  benar; H/V benar-benar instant-drop tanpa klik.
- **Mode cursor** — 4 varian menyetel crosshair sesuai harapan; ganti mode membatalkan gambar
  yang sedang berjalan.
- **Magnet** — titik menempel ke nilai O/H/L/C sungguhan; **preview juga sudah menempel**
  (mode `strong_magnet`), jadi tak ada lompatan saat commit; toggle saat menggambar langsung
  mengubah mode overlay in-progress.
- **Ganti TF** — objek tetap di harga yang identik dan waktu yang sama (≤1 bar TF baru).
- **Area future** — menggambar di kanan bar terakhir tidak "kelempar" ke tepi kiri; jaring
  pengaman di index.html:3081 bekerja.
- **11 area non-drawing** — watchlist, TF bar + dropdown, chart-type, indikator, bar replay,
  news kalender, price alerts, paper order, daftar instrumen, tema, pemuatan data. Semua
  hidup tanpa satu pun error JS tak tertangkap.

---

## Catatan metode

Tiga hal yang awalnya terlihat seperti bug aplikasi, tapi ternyata kesalahan test — dicatat
supaya tak diulang (detail di `tests/README.md`):

1. Klik "area future" yang sebenarnya mendarat di **sumbu harga** (sumbu ada di dalam
   `#chart`: plot 1172px dari container 1224px).
2. Double-click pada titik `ellipse`/`arrowMark` yang **bukan di atas bentuk** yang tergambar
   → dikira modal tak terbuka.
3. `horizontalRayLine`: Y klik ke-2 **wajib** diabaikan (garis harus tetap horizontal) →
   Δlanding Y 197px di situ bukan cacat.
