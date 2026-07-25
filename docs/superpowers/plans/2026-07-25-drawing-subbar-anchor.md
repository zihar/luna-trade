# Sub-Bar Anchor untuk Semua Tool Drawing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat 20 tool drawing yang saat ini meleset ½ bar mendarat tepat di piksel yang diklik, dengan satu mekanisme generik alih-alih 20 tambalan per-tool.

**Architecture:** Membalik default penambatan sumbu X. Hari ini `timestamp` (yang di-snap ke pusat bar oleh `convertToPixel` saat render) adalah default dan `dataIndex` pecahan adalah pengecualian bernama `trendline`; sesudahnya `dataIndex` pecahan jadi default dan snap per-bar jadi daftar-pengecualian eksplisit `BAR_ANCHOR`. Empat hook per-overlay (`onDrawing`, `onPressedMoving`, `onPressedMoveStart/End`) dipindah dari registrasi `trendline` ke `delHooks()` supaya berlaku per-instance untuk semua overlay — termasuk 9 overlay built-in klinecharts yang tak kita daftarkan sendiri.

**Tech Stack:** Vanilla JS di `index.html` monolitik (~380KB), klinecharts 9.8.10 (UMD dari unpkg), Playwright 1.49 untuk E2E.

**Spec:** `docs/superpowers/specs/2026-07-25-drawing-subbar-anchor-design.md`
**Temuan yang dikerjakan:** Temuan 1 di `docs/e2e-drawing-findings.md`
**Latar teknis klinecharts:** `docs/superpowers/specs/2026-07-10-trendline-precision-design.md` bagian "Temuan kunci klinecharts 9.8.10" — baca ini sebelum menyentuh hook apa pun.

## Global Constraints

- Semua teks yang tampil ke pengguna **bahasa Inggris**; komentar kode & pesan commit boleh Indonesian (CLAUDE.md).
- Commit conventional (Indonesian) + trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Branch: `zihar/zihar/fix/drawing-subbar-anchor` (sudah ada, dicabang dari `main`, sudah berisi commit spec).
- Rebase ke `origin/main` tiap hari selama branch hidup.
- Toleransi presisi: **≤1px** (X dan Y) untuk tool ber-`anchor: 'subbar'`; **½ barSpace + 1** untuk tool ber-`anchor: 'bar'`. Sumbernya `tests/helpers/spec.js:76-84` — jangan diubah.
- **Jangan melonggarkan toleransi atau mengubah `TOOL_SPEC` untuk membuat test hijau.** Test yang merah adalah spesifikasi yang benar.
- Tiga tool yang WAJIB tetap snap per-bar: `verticalStraightLine`, `longPosition`, `shortPosition`.
- Blok describe **"klik cepat"** di `20-parity.spec.js:120` tetap merah setelah semua task selesai — itu Temuan 2, di luar cakupan. Jangan mencoba memperbaikinya di sini.

## Latar: kenapa ½ bar

klinecharts merender titik overlay begini: kalau titik punya `timestamp`, `timestamp` **menang** dan di-snap ke indeks bar integer → pusat bar. Kalau titik hanya punya `dataIndex`, `convertToPixel` menerima **pecahan** dan merender presisi. Jadi menyimpan `timestamp` sub-bar yang presisi tak ada gunanya — presisinya hilang di layar. Perbaikannya bukan "menyimpan waktu lebih teliti", melainkan **mengganti jenis anchor**.

Setiap titik presisi selalu berbentuk `{dataIndex: <pecahan>, value: <harga>}` — **tanpa** `timestamp`. Kalau `timestamp` ikut terbawa, snap-nya kembali. Ini kesalahan yang paling mungkin terjadi saat mengerjakan plan ini.

## File Structure

Hanya satu file produksi yang disentuh — `index.html` monolitik (lihat CLAUDE.md "Akar masalah struktural"). Tak ada pemecahan modul di plan ini: itu pekerjaan terpisah, dan mencampurnya akan melanggar aturan satu-fitur-satu-PR.

| File | Tanggung jawab | Perubahan |
|---|---|---|
| `index.html` | seluruh UI + logika chart | 6 suntingan bertarget, semuanya di area drawing (baris ~689–3300) |
| `tests/drawing/70-reticle.spec.js` | **baru** — reticle preview menunjuk ke titik yang benar-benar akan mendarat | dibuat di Task 5 |
| `docs/e2e-drawing-findings.md` | catatan temuan E2E | Temuan 1 ditandai selesai di Task 7 |

**Deviasi dari spec yang disengaja:** spec bilang "tak ada file test yang diubah". Task 5 **menambah** satu file test baru untuk reticle. Alasannya: reticle saat ini tak diuji sama sekali, tapi perbaikan ini membuatnya load-bearing — tanpa perubahan, reticle akan menunjuk ½ bar dari tempat titik mendarat. Menambah test bukan mengubah ekspektasi yang ada.

## Peta hook: siapa memanggil apa

Baca ini sekali sebelum Task 1; tanpanya suntingan-suntingan di bawah terasa acak.

```
armTool → createOverlay(Object.assign({name,...}, delHooks()))
                                                  └─ hook per-INSTANCE. Sudah terbukti
                                                     dihormati klinecharts untuk
                                                     onDrawStart/onDrawEnd/onClick/…
                                                     → tempat yang benar untuk hook generik.

klik ke-1..n-1   → mousedown listener (index.html:3250) → pendingClicks.push({…, fidx})
gerak kursor     → onDrawing            ← titik in-progress ditulis ulang jadi fidx  [Task 1]
                 → updateMagDot          ← reticle harus pakai anchor yang SAMA       [Task 1]
tekan-geser-lepas→ onPressedMoving       ← jalur alternatif titik terakhir            [Task 4]
klik terakhir    → onDrawEnd             ← commit final ke fidx                       [Task 1]
setelah commit   → refineMagnetPoints    ← penyempurnaan harga presisi-M5             [Task 6]
reload           → buildDrawsFromArray   ← rekonstruksi dari wall-clock ke fidx       [Task 3]
```

`onDrawing` dan `onPressedMoving` saat ini hidup di **registrasi** `trendline`
(`index.html:934` blok `registerOverlay`), bukan di `delHooks()`. Itulah sebabnya hanya
`trendline` yang presisi.

---

### Task 0: Spike — apakah `onDrawing` per-instance dihormati untuk overlay built-in?

Task ini **dibuang**, tidak di-commit. Ia menjawab satu-satunya unknown yang menentukan bentuk semua task berikutnya: 9 dari 20 tool adalah overlay bawaan klinecharts yang tak kita daftarkan sendiri (`rayLine`, `straightLine`, `horizontalRayLine`, `priceLine`, `parallelStraightLine`, `priceChannelLine`, `fibonacciLine`, `simpleAnnotation`, `simpleTag`). Kalau hook per-instance tak berlaku untuk mereka, cakupan PR harus dipecah dua.

**Files:**
- Modify (sementara, akan di-`git checkout`): `index.html:3044`

**Interfaces:**
- Consumes: — (task pertama)
- Produces: keputusan biner yang dipakai Task 1 dan Task 4:
  - **HIJAU** = built-in ikut presisi → lanjutkan plan apa adanya.
  - **MERAH** = built-in tak terpengaruh → hentikan, lapor ke pemilik repo; plan dipecah jadi PR-1 (11 overlay custom) + PR-2 (registrasi ulang 9 built-in). Jangan lanjut sendiri.

- [ ] **Step 1: Pasang `onDrawing` sementara di `delHooks()`, khusus `rayLine`**

Di `index.html`, cari `function delHooks(){ return {` (sekitar baris 3044). Sisipkan hook ini sebagai properti **pertama** di dalam objek yang di-return, tepat sebelum `onDrawStart`:

```js
  // SPIKE — dibuang setelah pengukuran. Hanya rayLine (overlay BUILT-IN klinecharts).
  onDrawing:(e)=>{ const o=e&&e.overlay; if(!o||o.name!=='rayLine'||!o.points||!o.points.length) return false;
    const m=o.points.length-1;
    for(let k=0;k<m;k++){ const pc=pendingClicks[k];
      if(pc && isFinite(pc.fidx) && pc.value!=null) o.points[k]={dataIndex:pc.fidx, value:pc.value}; }
    const fa=fracAnchorFromPx(e.x); const v=pxToValue(e.y);
    if(fa && v!=null) o.points[m]={dataIndex:fa.dataIndex, value:v};
    return false;
  },
```

- [ ] **Step 2: Ukur `rayLine` di tiga mode**

Run:
```bash
npx playwright test tests/drawing/20-parity.spec.js -g "rayLine" --reporter=list
```

Ada tiga test untuk `rayLine`: "klik normal", "drag titik terakhir tetap presisi", dan "klik cepat".

Yang dibaca dari hasilnya:
- **"klik normal"** — apakah Δpreview turun dari ~3–4px ke ≤1px? Ini pertanyaan pokok spike. Δlanding masih boleh gagal (commit belum diperbaiki; itu Task 1).
- **"drag titik terakhir"** — kalau ini juga ikut membaik, `onDrawing` ternyata juga melayani jalur press-drag dan Task 4 tak diperlukan. Kalau tetap ~3–4px, Task 4 diperlukan.
- **"klik cepat"** — diabaikan; tetap merah (Temuan 2).

Angka Δ per titik ada di pesan kegagalan assertion (`preview (klik→rubber-band) X titik #0 (rayLine)`). Kalau butuh angka lengkap semua tool, buka `report/gallery.html` setelah `npm run gallery`.

- [ ] **Step 3: Cek risiko 2 — overlay built-in dengan titik turunan**

Run:
```bash
npx playwright test tests/drawing/20-parity.spec.js -g "priceChannelLine: preview" --reporter=list
```

Spike belum menyentuh `priceChannelLine` (hook di-gate ke `rayLine`), jadi test ini **harus tetap merah dengan angka yang sama seperti baseline** (~3–4px). Tujuannya memastikan hook per-instance tak bocor ke overlay lain. Kalau angkanya berubah, gate `o.name!=='rayLine'` tidak bekerja — perbaiki dulu sebelum menyimpulkan apa pun.

- [ ] **Step 4: Buang perubahan spike**

```bash
git checkout index.html
git diff --stat   # harus kosong
```

- [ ] **Step 5: Catat hasilnya**

Tulis satu paragraf di deskripsi PR nanti (belum ada file untuk ini): Δpreview `rayLine` sebelum → sesudah spike, dan apakah mode drag ikut membaik. Angka ini yang membenarkan keputusan cakupan.

**Gate:** kalau Step 2 menunjukkan Δpreview `rayLine` **tidak** membaik, **berhenti di sini** dan lapor. Sisa plan mengasumsikan hook per-instance bekerja.

---

### Task 1: Mekanisme inti — `BAR_ANCHOR`, preview, commit, reticle

Empat suntingan ini satu kesatuan atomik. Memisahkannya justru menghasilkan keadaan yang lebih buruk dari sekarang: `onDrawing` sendirian membuat preview presisi tapi hasil akhir tetap snap (objek jadi "loncat" saat klik terakhir — Δparity yang hari ini 0 malah rusak), dan tanpa `updateMagDot` reticle menunjuk ½ bar dari tempat titik mendarat.

**Files:**
- Modify: `index.html:712` (sisipkan `BAR_ANCHOR` + `subBar`)
- Modify: `index.html:964-976` (hapus `onDrawing` dari registrasi `trendline`)
- Modify: `index.html:3044` (tambah `onDrawing` generik di `delHooks()`)
- Modify: `index.html:3072` (gate commit)
- Modify: `index.html:3290` (gate reticle)
- Test: `tests/drawing/20-parity.spec.js` (sudah ada, tak diubah)

**Interfaces:**
- Consumes: keputusan HIJAU dari Task 0.
- Produces:
  - `BAR_ANCHOR` — objek `{[name:string]: 1}`, daftar tool yang sengaja snap per-bar.
  - `subBar(name: string) => boolean` — `true` bila tool itu harus presisi sub-bar. Dipakai Task 3, 4, dan 6.

- [ ] **Step 1: Jalankan baseline dan catat angkanya**

Run:
```bash
npx playwright test tests/drawing/20-parity.spec.js --reporter=list 2>&1 | tail -30
```

Expected: sejumlah test gagal dengan pesan berpola `landing (klik→objek): objek tak mendarat di tempat diklik — X titik #0 (rect)` dan angka ~3–4px. Catat jumlah passed/failed — inilah angka pembanding untuk Step 8.

- [ ] **Step 2: Tambahkan `BAR_ANCHOR` dan `subBar`**

Di `index.html`, cari baris ini (sekitar 711-712):

```js
// klik presisi yang dikumpulkan selama menggambar (menggantikan snap-ke-bar klinecharts)
let pendingClicks=[];
```

Sisipkan **tepat setelahnya**:

```js
// Penambatan sumbu X. Presisi sub-bar (dataIndex PECAHAN, tanpa timestamp) adalah DEFAULT —
// titik mendarat tepat di piksel klik. klinecharts merender titik ber-`timestamp` dgn men-snap
// ke pusat bar, jadi anchor timestamp = presisi hilang di layar (lihat
// docs/superpowers/specs/2026-07-10-trendline-precision-design.md).
// Snap per-bar disisakan HANYA untuk tool yang memang membutuhkannya:
//   verticalStraightLine — penanda waktu harus = waktu candle yg diklik (snapTimeToBar)
//   long/shortPosition   — entry harus mendarat di center candle terpilih (expandPosition)
// Pasangan tabel ini di sisi test: kolom `anchor` pada TOOL_SPEC (tests/helpers/spec.js).
const BAR_ANCHOR={verticalStraightLine:1, longPosition:1, shortPosition:1};
const subBar=(name)=>!BAR_ANCHOR[name];
```

- [ ] **Step 3: Pindahkan `onDrawing` dari registrasi `trendline` ke `delHooks()`**

Di registrasi `trendline` (sekitar `index.html:960-976`), **hapus** seluruh blok komentar + hook berikut. Blok komentar ikut dipindah — isinya penjelasan yang masih berlaku:

```js
  // Preview PRESISI: saat menggambar, klinecharts men-snap titik in-progress ke pusat bar
  // (integer dataIndex + timestamp) sehingga garis PREVIEW beda dari titik FINAL yg kita commit
  // sbg dataIndex PECAHAN → garis "loncat" ±½ bar saat klik ke-2. Nilai balik onDrawing DIABAIKAN
  // klinecharts (beda dari onPressedMoving yg di-gate), jadi titik in-progress ditulis ulang
  // LANGSUNG di sini: dataIndex pecahan TANPA timestamp (spy render tak re-snap), identik dgn
  // jalur commit di onDrawEnd → preview == final (nol geser) utk horizontal/vertikal/diagonal.
  // Magnet hanya menyetel VALUE (harga) ke OHLC; X tetap ikut kursor supaya preview & commit
  // konsisten (commit trendline juga pakai fidx kursor). e.x/e.y = container-relative (spt onPressedMoving).
  onDrawing:(e)=>{ const o=e&&e.overlay; if(!o||!o.points||!o.points.length) return false;
    const m=o.points.length-1;                        // titik yg sedang ditarik = indeks terakhir
    for(let k=0;k<m;k++){ const pc=pendingClicks[k];  // titik yg sudah diklik → re-anchor ke fidx presisi
      if(pc && isFinite(pc.fidx) && pc.value!=null) o.points[k]={dataIndex:pc.fidx, value:pc.value}; }
    const fa=fracAnchorFromPx(e.x); let v=pxToValue(e.y);
    if(magnetOn && v!=null){ const xa=xAnchorFromPx(e.x);   // magnet: value → OHLC terdekat, X tetap kursor
      if(xa && xa.timestamp!=null){ const s=magnetSnap(tsOf(xa), v, e.x, e.y); if(s) v=s.value; } }
    if(fa && v!=null) o.points[m]={dataIndex:fa.dataIndex, value:v};
    return false;
  },
```

Lalu di `delHooks()` (cari `function delHooks(){ return {`, sekitar `index.html:3044`), sisipkan versi generiknya sebagai properti **pertama**, tepat sebelum `onDrawStart`:

```js
  // Preview PRESISI untuk SEMUA tool sub-bar. klinecharts men-snap titik in-progress ke pusat
  // bar (integer dataIndex + timestamp) → rubber-band tak mengikuti kursor & final "loncat".
  // Nilai balik onDrawing DIABAIKAN klinecharts (beda dari onPressedMoving yg di-gate), jadi
  // titik in-progress ditulis ulang LANGSUNG di sini: dataIndex PECAHAN tanpa timestamp (supaya
  // render tak re-snap), identik dgn jalur commit di onDrawEnd → preview == final.
  // Hook ini per-INSTANCE lewat createOverlay, jadi berlaku juga untuk 9 overlay BUILT-IN
  // klinecharts yang tak kita daftarkan sendiri.
  // Magnet hanya menyetel VALUE (harga) ke OHLC; X tetap ikut kursor supaya preview & commit
  // konsisten. e.x/e.y = container-relative (sama ruang dgn fracAnchorFromPx/pxToValue).
  onDrawing:(e)=>{ const o=e&&e.overlay; if(!o||!o.points||!o.points.length||!subBar(o.name)) return false;
    const m=o.points.length-1;                        // titik yg sedang ditarik = indeks terakhir
    for(let k=0;k<m;k++){ const pc=pendingClicks[k];  // titik yg sudah diklik → re-anchor ke fidx presisi
      if(pc && isFinite(pc.fidx) && pc.value!=null) o.points[k]={dataIndex:pc.fidx, value:pc.value}; }
    const fa=fracAnchorFromPx(e.x); let v=pxToValue(e.y);
    if(magnetOn && v!=null){ const xa=xAnchorFromPx(e.x);   // magnet: value → OHLC terdekat, X tetap kursor
      if(xa && xa.timestamp!=null){ const s=magnetSnap(tsOf(xa), v, e.x, e.y); if(s) v=s.value; } }
    if(fa && v!=null) o.points[m]={dataIndex:fa.dataIndex, value:v};
    return false;
  },
```

Satu-satunya beda dari versi lama: tambahan `||!subBar(o.name)` di guard, dan komentarnya diperbarui.

- [ ] **Step 4: Lebarkan gate commit di `onDrawEnd`**

Sekitar `index.html:3070-3078`. Ganti komentar + baris gate:

```js
      // Trendline: pindahkan anchor ke dataIndex PECAHAN (bukan timestamp) supaya garis & handle
      // dirender presisi di titik klik. Fraksi presisi diambil dari fidx klik (pendingClicks) saat
      // refine berhasil; fallback ke dataIndex titik / fidxOf (snap ke bar) bila desync.
      if(o.name==='trendline'){ o.points=o.points.map((p,k)=>{ if(!p||p.value==null) return p;
```

menjadi:

```js
      // Tool sub-bar: pindahkan anchor ke dataIndex PECAHAN (bukan timestamp) supaya bentuk &
      // handle dirender presisi di titik klik. Fraksi presisi diambil dari fidx klik
      // (pendingClicks) saat refine berhasil; fallback ke dataIndex titik / fidxOf (snap ke bar)
      // bila desync. Tool di BAR_ANCHOR sengaja dilewati — snap per-bar-nya memang diinginkan.
      if(subBar(o.name)){ o.points=o.points.map((p,k)=>{ if(!p||p.value==null) return p;
```

Sisa isi `.map(...)` tak berubah.

- [ ] **Step 5: Lebarkan gate reticle di `updateMagDot`**

Sekitar `index.html:3288-3292`. Ganti:

```js
    const o=chart.getOverlayById(inProgressId), name=o&&o.name;
    if(name==='trendline'){ const fa=fracAnchorFromPx(px); if(fa) anchor={dataIndex:fa.dataIndex, value:v}; }   // presisi sub-bar (fidx)
    else { const xa=xAnchorFromPx(px); if(xa) anchor=Object.assign({value:v}, xa); }                            // timestamp/dataIndex (ikut snap render)
```

menjadi:

```js
    const o=chart.getOverlayById(inProgressId), name=o&&o.name;
    if(subBar(name)){ const fa=fracAnchorFromPx(px); if(fa) anchor={dataIndex:fa.dataIndex, value:v}; }   // presisi sub-bar (fidx)
    else { const xa=xAnchorFromPx(px); if(xa) anchor=Object.assign({value:v}, xa); }                      // BAR_ANCHOR: timestamp (ikut snap render)
```

Ini wajib satu paket dengan Step 3–4: reticle harus memakai anchor yang **identik** dengan titik yang akan di-commit, kalau tidak ia menunjuk ½ bar meleset dari tempat titik benar-benar mendarat.

- [ ] **Step 6: Jalankan test presisi klik normal**

Run:
```bash
npx playwright test tests/drawing/20-parity.spec.js -g "klik normal" --reporter=list 2>&1 | tail -30
```

Expected: **24 dari 24 lolos.** Ke-20 tool sub-bar sekarang ≤1px di Δparity, Δpreview, dan Δlanding; tiga tool `BAR_ANCHOR` tetap lolos pada toleransi longgarnya; `trendline` tetap lolos (tak ada regresi).

Kalau ada yang masih merah, baca nama metriknya di pesan assertion sebelum menebak:
- **Δpreview masih besar** → `onDrawing` tak terpanggil untuk tool itu (guard salah, atau hook per-instance tak berlaku untuk overlay itu).
- **Δlanding masih besar tapi Δpreview kecil** → gate Step 4 tak kena; cek `refine` gugur (`index.html:3064`) sehingga `pc.fidx` tak dipakai.
- **Δparity besar (preview ≠ final)** → dua jalur memakai anchor beda; Step 3 dan Step 4 harus menghasilkan bentuk titik yang sama persis.

- [ ] **Step 7: Pastikan tak ada regresi di tempat lain**

Run:
```bash
npx playwright test tests/drawing/30-interaction.spec.js tests/drawing/60-magnet-tf.spec.js --reporter=list 2>&1 | tail -20
```

Expected: semuanya lolos, sama seperti baseline. Blok "persist setelah reload" menguji `rect` dan `horizontalStraightLine` yang baru saja pindah anchor — kalau blok itu merah, penyebabnya jalur restore, yang memang belum dikerjakan (Task 3). Kalau begitu, kerjakan Task 3 dulu lalu kembali ke sini.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
fix(draw): anchor sub-bar jadi default untuk semua tool drawing

klinecharts merender titik ber-timestamp dgn men-snap ke pusat bar, jadi
20 dari 24 tool mendarat ½ bar (3-4px) dari titik yang diklik. Hanya
trendline yang beranchor dataIndex pecahan.

Membalik defaultnya: presisi sub-bar untuk semua, snap per-bar disisakan
sebagai daftar-pengecualian eksplisit (BAR_ANCHOR) untuk tiga tool yang
memang butuh. onDrawing dipindah dari registrasi trendline ke delHooks()
supaya berlaku per-instance — termasuk untuk 9 overlay built-in
klinecharts. Reticle ikut dipindah ke anchor yang sama supaya tak
menunjuk meleset dari titik yang akan mendarat.

Temuan 1 docs/e2e-drawing-findings.md.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Verifikasi tak ada `name==='trendline'` yang tertinggal di jalur anchoring

Task pendek tapi punya gerbangnya sendiri: literal yang tertinggal berarti satu tool diam-diam berperilaku beda, dan itu justru kelas bug yang sedang kita hapus.

**Files:**
- Modify (bila ada temuan): `index.html`

**Interfaces:**
- Consumes: `subBar()` dari Task 1.
- Produces: jaminan bahwa satu-satunya sumber kebenaran anchoring adalah `BAR_ANCHOR`.

- [ ] **Step 1: Cari semua sisa literal**

Run:
```bash
grep -n "trendline" index.html
```

- [ ] **Step 2: Klasifikasikan tiap temuan**

Yang **harus** diganti `subBar(...)`: apa pun yang memutuskan bentuk anchor sebuah titik (`{dataIndex}` vs `{timestamp}`).

Yang **benar** tetap menyebut `trendline` secara literal — jangan diubah:
- `DRAW_DEFAULT.trendline` (`index.html:716`) — style default per-tool.
- `posRerender` (`index.html:3042`): `(o.name==='rect'||o.name==='trendline')` — memaksa redraw agar undangan "+ Add text" muncul/hilang; soal teks, bukan anchor.
- Entri di `PERSIST_DRAW`, `BUILTIN_LINE`, `ADDTEXT_CLICK`, `DM_TEXT_OBJS`, dan daftar tool di rail.
- Blok `registerOverlay({name:'trendline', ...})` itu sendiri.

Yang tersisa setelah Task 1: `buildDrawsFromArray` (Task 3) dan `onPressedMoving`/`onPressedMoveStart` (Task 4). Keduanya memang belum dikerjakan — catat, jangan sentuh sekarang.

- [ ] **Step 3: Kalau ada temuan di luar daftar itu, perbaiki dan commit**

```bash
git add index.html
git commit -m "fix(draw): sisa gate trendline di jalur anchoring ikut pakai subBar()

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Kalau tak ada temuan, lewati commit dan lanjut ke Task 3.

---

### Task 3: Restore dari localStorage ikut anchor sub-bar

Tanpa task ini, objek presisi kembali ke posisi snap-per-bar setelah reload — geser ½ bar yang muncul entah dari mana di mata pengguna.

**Files:**
- Modify: `index.html:3194`
- Test: `tests/drawing/30-interaction.spec.js` blok "persist setelah reload" (sudah ada, tak diubah)

**Interfaces:**
- Consumes: `subBar()` dari Task 1.
- Produces: —

- [ ] **Step 1: Jalankan test persist dan lihat statusnya sekarang**

Run:
```bash
npx playwright test tests/drawing/30-interaction.spec.js -g "persist" --reporter=list
```

Blok ini menguji tiga tool: `trendline`, `rect`, `horizontalStraightLine`. Dua yang terakhir baru pindah anchor di Task 1. Assertion-nya membandingkan posisi pixel sebelum vs sesudah reload dengan toleransi ≤1px — jadi ia menangkap "presisi saat digambar, snap setelah reload".

- [ ] **Step 2: Lebarkan gate di `buildDrawsFromArray`**

Sekitar `index.html:3193-3197`. Ganti:

```js
      if(d.name==='trendline'){ const fi=tsToFracIndex(pt.vt);   // trendline: SELALU dataIndex pecahan (presisi)
        return fi!=null ? {dataIndex:fi, value:pt.value} : {timestamp:pt.vt, value:pt.value}; }
      return (lt!=null && pt.vt>lt) ? {dataIndex: li+(pt.vt-lt)/dur, value:pt.value}   // overlay lain: future → dataIndex
        : {timestamp:pt.vt, value:pt.value};
```

menjadi:

```js
      if(subBar(d.name)){ const fi=tsToFracIndex(pt.vt);   // tool sub-bar: SELALU dataIndex pecahan (presisi)
        return fi!=null ? {dataIndex:fi, value:pt.value} : {timestamp:pt.vt, value:pt.value}; }
      return (lt!=null && pt.vt>lt) ? {dataIndex: li+(pt.vt-lt)/dur, value:pt.value}   // BAR_ANCHOR: future → dataIndex
        : {timestamp:pt.vt, value:pt.value};
```

Sisi simpan (`serializeDraws`, `index.html:3163`) **tak perlu diubah**: ia sudah menyimpan wall-clock lewat `tsOf(p)`, yang menangani titik ber-`dataIndex` dengan `fidxToTs`.

- [ ] **Step 3: Jalankan test persist**

Run:
```bash
npx playwright test tests/drawing/30-interaction.spec.js -g "persist" --reporter=list
```

Expected: 3 dari 3 lolos.

- [ ] **Step 4: Verifikasi ganti TF tak regresi**

Run:
```bash
npx playwright test tests/drawing/60-magnet-tf.spec.js -g "timeframe" --reporter=list
```

Expected: lolos. Jalur ini (`snapshotFuturePoints` → `reanchorFuturePoints`, `index.html:1783`) menyaring titik berdasarkan **bentuk** (`p.timestamp==null && p.dataIndex!=null`), bukan nama, jadi tool yang baru pindah anchor otomatis tercakup tanpa perubahan kode. Test ini membuktikannya.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "fix(draw): restore dari localStorage ikut anchor sub-bar

Tanpa ini objek presisi kembali ke posisi snap-per-bar setelah reload.
serializeDraws tak perlu diubah — tsOf(p) sudah menangani dataIndex.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Jalur press-drag dan drag setelah objek jadi

**Kerjakan hanya bila** Task 0 Step 2 menunjukkan mode drag **tidak** ikut membaik, atau Task 1 Step 6 menyisakan blok "press-drag" merah. Jalankan dulu pengeceknya di Step 1.

Dua hal berbeda memakai jalur yang sama di sini:
1. **Press-drag saat menggambar** — titik terakhir ditaruh lewat tekan-geser-lepas alih-alih klik (`20-parity.spec.js:106`, mode `'drag'`). Diuji untuk semua tool multi-titik.
2. **Drag setelah objek jadi** — menggeser satu titik atau badan objek. `30-interaction.spec.js:15` hanya mengujinya untuk `trendline`, jadi 19 tool lain **tak teruji** dan kemungkinan besar snap per-bar. Task ini menutup keduanya sekaligus.

**Files:**
- Modify: `index.html:977-1000` (pindahkan `onPressedMoveStart` / `onPressedMoving` dari registrasi `trendline`)
- Modify: `index.html:3044` (tambahkan keduanya ke `delHooks()`)
- Modify: `index.html` deklarasi `tlDrag` (rename)
- Test: `tests/drawing/20-parity.spec.js` blok "press-drag" (sudah ada, tak diubah)

**Interfaces:**
- Consumes: `subBar()` dari Task 1.
- Produces: —

Baseline terverifikasi 2026-07-25 (`npm test` di branch ini setelah #119 merge): **13 test
press-drag merah** — `rayLine`, `straightLine`, `horizontalRayLine`, `parallelStraightLine`,
`priceChannelLine`, `fib3`, `fibonacciLine`, `rect`, `circle`, `ellipse`, `arrow`, `dateRange`,
`callout`. Yang belum diketahui hanyalah apakah Task 1 sudah ikut menghijaukannya; Step 1
menjawab itu.

- [ ] **Step 1: Cek apakah task ini diperlukan**

Run:
```bash
npx playwright test tests/drawing/20-parity.spec.js -g "press-drag" --reporter=list 2>&1 | tail -20
```

Kalau semuanya lolos, **lewati seluruh Task 4** dan lanjut ke Task 5 — `onDrawing` ternyata sudah melayani jalur ini juga. Catat itu di deskripsi PR. Kalau ada yang merah, lanjutkan.

- [ ] **Step 2: Rename `tlDrag` → `dragBase`**

Variabelnya khusus-trendline hanya pada namanya. Cari deklarasi `let tlDrag` dan ganti semua kemunculannya:

```bash
grep -n "tlDrag" index.html
```

Ganti tiap `tlDrag` menjadi `dragBase`. Ada di deklarasi, `onPressedMoveStart`, `onPressedMoving` (dua kali), dan `onPressedMoveEnd`.

- [ ] **Step 3: Pindahkan hook drag ke `delHooks()`**

Dari registrasi `trendline` (sekitar `index.html:977-1001`), **hapus** `onPressedMoveStart`, `onPressedMoving`, dan `onPressedMoveEnd` beserta blok komentarnya. Sisipkan ke `delHooks()` tepat setelah `onDrawing` yang ditambahkan di Task 1, dengan guard `subBar` di masing-masing:

```js
  // Drag PRESISI untuk tool sub-bar: klinecharts default mengubah kursor→titik via
  // _coordinateToPoint yg meng-snap ke indeks integer. Dengan return true di onPressedMoving,
  // default itu dilewati dan kita tulis dataIndex PECAHAN sendiri (endpoint) / translasi semua
  // titik (badan objek). e.x/e.y klinecharts = clientX-target.left (container-relative) → sama
  // ruang dgn fracAnchorFromPx/pxToValue (OX=OY=0).
  // Tool di BAR_ANCHOR dilewati: long/shortPosition punya performEventPressedMove sendiri
  // (posPressedMove) yg tak boleh ditimpa.
  onPressedMoveStart:(e)=>{ const o=e&&e.overlay; if(o&&subBar(o.name)) dragBase={pts:(o.points||[]).map(p=>Object.assign({},p)), x:e.x, y:e.y}; return false; },
  onPressedMoving:(e)=>{ const o=e&&e.overlay; if(!o||!o.points||!subBar(o.name)) return false;
    const OX=0, OY=0;
    const xa=fracAnchorFromPx(e.x-OX), v=pxToValue(e.y-OY);
    if(!xa || v==null) return false;
    const pts=o.points.map(p=>Object.assign({},p));
    const key=e.figureKey||'';
    if(key.indexOf('overlay_figure_point_')===0){       // seret SATU ujung
      const i=e.figureIndex; if(pts[i]) pts[i]={dataIndex:xa.dataIndex, value:v};
    } else {                                            // seret BADAN objek → translasi semua titik
      if(!dragBase) return false;
      const sx=fracAnchorFromPx(dragBase.x-OX), sv=pxToValue(dragBase.y-OY);
      if(!sx || sv==null) return false;
      const dIdx=xa.dataIndex-sx.dataIndex, dV=v-sv;
      for(let i=0;i<pts.length;i++){ const sp=dragBase.pts[i]; if(!sp) continue;
        const bi=(sp.dataIndex!=null)?sp.dataIndex:fidxOf(sp);
        pts[i]={dataIndex: bi+dIdx, value: (sp.value!=null?sp.value:v)+dV}; }
    }
    try{ chart.overrideOverlay({id:o.id, points:pts}); }catch(_){}
    return true;                                        // lewati snap bawaan klinecharts
  },
  onPressedMoveEnd:(e)=>{ dragBase=null; try{ if(magnetOn&&e&&e.overlay) refineMagnetPoints(e.overlay.id); }catch(_){} return false; },
```

Periksa baris terakhir `onPressedMoveEnd` versi lama di `index.html:1001` sebelum menghapusnya — kalau ia melakukan sesuatu selain yang tersalin di atas (mis. `scheduleSaveDraws()`), bawa juga.

- [ ] **Step 4: Jalankan test press-drag**

Run:
```bash
npx playwright test tests/drawing/20-parity.spec.js -g "press-drag" --reporter=list 2>&1 | tail -20
```

Expected: semua lolos.

- [ ] **Step 5: Pastikan drag `trendline` yang sudah ada tak regresi**

Run:
```bash
npx playwright test tests/drawing/30-interaction.spec.js -g "drag" --reporter=list
```

Expected: 2 dari 2 lolos. Ini yang menjaga bahwa memindahkan hook (bukan menulis ulang) tak mengubah perilaku yang sudah benar.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "fix(draw): jalur drag ikut presisi sub-bar untuk semua tool

onPressedMoveStart/Moving/MoveEnd dipindah dari registrasi trendline ke
delHooks() dgn guard subBar(), sejalan dgn onDrawing. Menutup dua hal:
titik terakhir yang ditaruh lewat press-drag saat menggambar, dan drag
objek setelah jadi — yang selama ini hanya presisi untuk trendline.

tlDrag → dragBase (variabelnya tak lagi khusus trendline).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Test reticle — dot preview menunjuk tepat ke titik yang akan mendarat

Reticle (`magDot`) diubah di Task 1 tapi tak punya test sama sekali. Ia load-bearing sekarang: kalau anchornya melenceng dari anchor commit, pengguna membidik di satu tempat dan objeknya mendarat di tempat lain — persis keluhan yang sedang kita perbaiki, hanya sumbernya beda.

**Files:**
- Create: `tests/drawing/70-reticle.spec.js`

**Interfaces:**
- Consumes: `chartRect` dari `tests/helpers/chart.js`; `armTool`, `setCursor`, `CLICK_GAP_MS` dari `tests/helpers/draw.js`; `gotoApp`, `assertNoPageErrors` dari `tests/helpers/app.js`. (Semuanya sudah ada di `module.exports` masing-masing helper — tak perlu menambah ekspor baru.)
- Produces: —

- [ ] **Step 1: Tulis test yang gagal**

Bikin `tests/drawing/70-reticle.spec.js`:

```js
// Reticle preview (#chart .mag-dot, index.html:3275) adalah bidikan: ia menjanjikan "titik akan
// mendarat DI SINI". Janji itu hanya benar bila ia memakai anchor yang IDENTIK dengan yang
// di-commit onDrawEnd. Sebelum anchor sub-bar digeneralisasi, reticle memakai xAnchorFromPx
// (timestamp → snap ke pusat bar) untuk semua tool kecuali trendline → meleset ½ bar.

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect } = require('../helpers/chart');
const { armTool, setCursor, CLICK_GAP_MS } = require('../helpers/draw');

// Satu per geometri: garis 2-titik custom, kotak yang mengembang, dan overlay BUILT-IN
// klinecharts (jalur hook per-instance).
const SAMPLES = ['trendline', 'rect', 'rayLine'];

/** Posisi tengah dot reticle, relatif terhadap #chart. null bila tersembunyi. */
async function dotAt(page) {
  return page.evaluate(() => {
    const d = document.querySelector('#chart .mag-dot');
    // display kosong = belum pernah diposisikan (bukan hanya 'none'); tanpa cek ini
    // parseFloat('') → NaN dan assertion gagal dengan pesan yang menyesatkan.
    if (!d || d.style.display !== 'block' || !d.style.left) return null;
    return { x: parseFloat(d.style.left), y: parseFloat(d.style.top) };
  });
}

test.describe('reticle preview', () => {
  for (const name of SAMPLES) {
    test(`${name}: dot mendarat tepat di kursor (bukan di pusat bar)`, async ({ page }) => {
      await gotoApp(page);
      const rect = await chartRect(page);

      // Reticle hanya tampil pada mode cursor 'dot' (index.html:3282).
      await setCursor(page, 'dot');
      await armTool(page, name);

      // Sengaja membidik posisi yang JELAS bukan pusat bar: offset ganjil dari titik acuan.
      const target = { x: Math.round(rect.width * 0.45) + 3, y: Math.round(rect.height * 0.4) + 3 };
      await page.mouse.move(rect.x + target.x, rect.y + target.y, { steps: 6 });
      await page.waitForTimeout(CLICK_GAP_MS);

      const dot = await dotAt(page);
      expect(dot, `${name}: reticle harus tampil saat menggambar di mode cursor 'dot'`).not.toBeNull();
      expect(Math.abs(dot.x - target.x), `${name}: reticle X harus di kursor, bukan pusat bar`).toBeLessThanOrEqual(1);
      expect(Math.abs(dot.y - target.y), `${name}: reticle Y harus di kursor`).toBeLessThanOrEqual(1);

      await page.keyboard.press('Escape');
      assertNoPageErrors(page);
    });
  }
});
```

- [ ] **Step 2: Jalankan — harus LOLOS bila Task 1 benar**

Run:
```bash
npx playwright test tests/drawing/70-reticle.spec.js --reporter=list
```

Expected: 3 dari 3 lolos, karena Task 1 Step 5 sudah memperbaikinya.

- [ ] **Step 3: Buktikan test ini benar-benar menangkap bug-nya**

Test yang tak pernah merah tak membuktikan apa-apa. Balikkan sementara gate reticle di `index.html:3290` — ganti `subBar(name)` jadi `name==='trendline'` — lalu jalankan lagi:

```bash
npx playwright test tests/drawing/70-reticle.spec.js --reporter=list
```

Expected: `rect` dan `rayLine` **GAGAL** dengan Δ ~3–4px; `trendline` tetap lolos. Kalau ketiganya tetap hijau, test-nya tak mengukur apa yang dimaksud — perbaiki dulu.

Kembalikan gate-nya:
```bash
git checkout index.html
```

⚠️ `git checkout index.html` membuang **semua** perubahan `index.html` yang belum di-commit. Aman di sini karena Task 1–4 sudah di-commit. Kalau ada perubahan lain yang menggantung, batalkan suntingannya dengan tangan.

- [ ] **Step 4: Commit**

```bash
git add tests/drawing/70-reticle.spec.js
git commit -m "test(e2e): reticle preview menunjuk tepat ke titik yang akan mendarat

Reticle jadi load-bearing setelah anchor sub-bar digeneralisasi: kalau
anchornya beda dari yang di-commit, pengguna membidik di satu tempat dan
objek mendarat di tempat lain. Sebelumnya tak teruji sama sekali.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `refineMagnetPoints` bekerja lagi untuk titik ber-anchor `dataIndex`

`refineMagnetPoints` (`index.html:689`) menaikkan presisi harga titik magnet dari "OHLC bar TF sekarang" ke "OHLC candle M5 sungguhan" saat TF > M5. Syaratnya `p.timestamp != null` (`index.html:698`), jadi begitu sebuah titik beranchor `dataIndex` ia **diam-diam jadi no-op**. Sebelum plan ini itu hanya menimpa `trendline` (diakui sebagai follow-up di `index.html:685-687`); setelah Task 1 ia menimpa 13 tool.

**Files:**
- Modify: `index.html:683-708`

**Interfaces:**
- Consumes: `tsOf()` (`index.html:575`) — mengembalikan wall-clock ms dari titik ber-`timestamp` **atau** ber-`dataIndex` (lewat `fidxToTs`).
- Produces: —

- [ ] **Step 1: Jalankan test magnet dan catat baseline**

Run:
```bash
npx playwright test tests/drawing/60-magnet-tf.spec.js -g "magnet" --reporter=list
```

Expected: 3 dari 3 lolos. Test ini memeriksa titik menempel ke **salah satu nilai OHLC**, dan itu sudah dijamin `magnetSnap` di jalur klik — bukan oleh `refineMagnetPoints`. Jadi ia tak akan menangkap regresi Task 6; ia hanya menjaga agar Task 6 tak merusak yang sudah jalan. Perbaikan presisi-M5-nya sendiri diverifikasi manual di Step 4.

- [ ] **Step 2: Ganti gate `timestamp` menjadi `tsOf`, dan hanya tulis ulang `value`**

Di `index.html:696-706`, ganti:

```js
    for(const p of pts){
      if(p.timestamp==null||p.value==null) continue;
      const rng=barRangeContaining(cur,p.timestamp); if(!rng) continue;
      const m5=await ensureM5Window(rng.open,rng.end); if(!m5||!m5.length) continue;
      let best=null,bd=Infinity;
      for(const c of m5){ if(c.timestamp>=rng.open && c.timestamp<rng.end){
        for(const v of [c.open,c.high,c.low,c.close]){ const d=Math.abs(v-p.value); if(d<bd){bd=d; best={timestamp:c.timestamp,value:v};} }
      }}
      // magnet "keras": semua titik digeser ke nilai OHLC M5 sebenarnya (tanpa gate jarak).
      if(best && (best.timestamp!==p.timestamp || best.value!==p.value)){ p.timestamp=best.timestamp; p.value=best.value; changed=true; }
    }
```

menjadi:

```js
    for(const p of pts){
      if(p.value==null) continue;
      const t=tsOf(p); if(t==null) continue;   // titik ber-dataIndex pecahan ikut terlayani (fidxToTs)
      const rng=barRangeContaining(cur,t); if(!rng) continue;
      const m5=await ensureM5Window(rng.open,rng.end); if(!m5||!m5.length) continue;
      let best=null,bd=Infinity;
      for(const c of m5){ if(c.timestamp>=rng.open && c.timestamp<rng.end){
        for(const v of [c.open,c.high,c.low,c.close]){ const d=Math.abs(v-p.value); if(d<bd){bd=d; best={value:v};} }
      }}
      // magnet "keras": semua titik digeser ke nilai OHLC M5 sebenarnya (tanpa gate jarak).
      // HANYA value yang disempurnakan — anchor X dibiarkan apa adanya, sesuai kebijakan magnet:
      // "magnet hanya menyetel VALUE; X tetap ikut kursor". Menulis p.timestamp di sini akan
      // MENGHAPUS presisi sub-bar titik ber-dataIndex (render meng-snap timestamp ke pusat bar).
      if(best && best.value!==p.value){ p.value=best.value; changed=true; }
    }
```

Tiga hal yang berubah: gate memakai `tsOf(p)`, `best` tak lagi membawa `timestamp`, dan penulisan `p.timestamp` dihapus.

- [ ] **Step 3: Perbarui komentar usang di atas fungsi**

Di `index.html:685-687`, hapus catatan follow-up yang sudah tak berlaku:

```js
// CATATAN: titik trendline kini beranchor dataIndex (tanpa timestamp) → refine M5 di bawah
// (yang butuh p.timestamp) menjadi no-op untuk trendline. Magnet saat MENGGAMBAR tetap bekerja
// (snap nilai OHLC via pendingClicks). Penyempurnaan X presisi-M5 untuk trendline = follow-up.
```

ganti dengan:

```js
// Berlaku untuk titik ber-timestamp MAUPUN ber-dataIndex pecahan (lewat tsOf). Yang
// disempurnakan hanya VALUE; anchor X tak disentuh supaya presisi sub-bar tak hilang.
```

- [ ] **Step 4: Verifikasi manual — satu-satunya cara melihat efeknya**

Test hermetik memakai fixture candle dan tak memuat data M5 nyata, jadi jalur ini tak terukur di `npm test`. Verifikasi di browser:

```bash
PORT=8765 ./luna-trade   # butuh .env dgn OANDA_TOKEN
```

Lalu: login → muat instrumen apa pun → set TF ke **H1** (lebih kasar dari M5, syarat `index.html:692`) → aktifkan magnet → gambar sebuah `trendline` dan sebuah `rayLine` dengan titik dekat high/low candle.

Yang harus terlihat: titik menempel ke harga OHLC, **dan** posisi X-nya tetap di tempat kamu klik (tak melompat ke pusat bar). Sebelum Task 6, `rayLine` akan melompat kembali ke pusat bar setelah magnet refine selesai.

Kalau `.env`/OANDA tak tersedia, lewati verifikasi ini dan catat di deskripsi PR bahwa jalur presisi-M5 magnet belum diverifikasi manual — jangan mengklaimnya lolos.

- [ ] **Step 5: Jalankan test magnet lagi**

Run:
```bash
npx playwright test tests/drawing/60-magnet-tf.spec.js --reporter=list
```

Expected: semua lolos (sama seperti Step 1 — task ini tak boleh meregresi apa pun).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "fix(draw): refineMagnetPoints bekerja lagi untuk titik ber-anchor dataIndex

Gate p.timestamp!=null membuat fungsi ini diam-diam jadi no-op begitu
titik beranchor dataIndex pecahan — sebelumnya hanya menimpa trendline,
setelah anchor sub-bar digeneralisasi jadi menimpa 13 tool. Gate diganti
tsOf(p), dan hanya value yang ditulis ulang: menulis p.timestamp justru
menghapus presisi sub-bar yang baru saja diperbaiki.

Menutup follow-up yang menggantung di komentar index.html.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Verifikasi menyeluruh, tinjauan galeri, dan perbarui catatan temuan

**Files:**
- Modify: `docs/e2e-drawing-findings.md`

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: PR siap review.

- [ ] **Step 1: Jalankan seluruh suite**

Run:
```bash
npm test 2>&1 | tail -40
```

Expected: naik dari baseline 112/163. Yang **masih boleh merah** hanyalah:
- blok describe **"klik cepat"** di `20-parity.spec.js` (Temuan 2),
- test Temuan 3 di `40-modal-text.spec.js` describe "keterjangkauan objek",
- test Temuan 4 di `50-rail.spec.js` (instant-drop `lastPtr` basi).

Apa pun di luar ketiga kelompok itu adalah regresi — jangan lanjut sebelum bersih.

- [ ] **Step 2: Bangun dan tinjau galeri dengan mata**

```bash
npm run gallery
open report/gallery.html
```

Angka bisa hijau sementara bentuknya salah. Yang dicari, per tool:
- arah arrowhead `arrow` / `arrowMarkUp` / `arrowMarkDown` masih benar,
- `rect` dan `fib3` masih persegi (tak miring / tak mengecil) setelah mengembang jadi 8 titik,
- `parallelStraightLine` dan `priceChannelLine` — garis keduanya masih **sejajar**; ini yang paling mungkin rusak karena titik ke-3-nya turunan (risiko 2 di spec),
- `circle` / `ellipse` tak gepeng,
- tak ada objek yang hilang dari foto final.

- [ ] **Step 3: Tandai Temuan 1 selesai di catatan temuan**

Di `docs/e2e-drawing-findings.md`, pada judul Temuan 1 (baris 12), ubah:

```markdown
## Temuan 1 — Menggambar tak mengikuti kursor: 20 dari 24 tool meleset ½ bar
```

menjadi:

```markdown
## Temuan 1 — Menggambar tak mengikuti kursor: 20 dari 24 tool meleset ½ bar — SELESAI

**Status:** diperbaiki 2026-07-25, lihat
`docs/superpowers/specs/2026-07-25-drawing-subbar-anchor-design.md`.
Presisi sub-bar kini default untuk semua tool; snap per-bar disisakan sebagai daftar
pengecualian eksplisit `BAR_ANCHOR` (`index.html`) untuk `verticalStraightLine` dan
`long/shortPosition`.
```

Jangan menghapus isi temuannya — analisis akar masalahnya masih jadi rujukan.

Perbarui juga baris ringkasan di atas (baris 4) dari `**112 lolos · 51 gagal**` menjadi angka hasil Step 1, dengan catatan singkat bahwa sisa merah = Temuan 2–4.

- [ ] **Step 4: Commit dan buka PR**

```bash
git add docs/e2e-drawing-findings.md
git commit -m "docs: tandai Temuan 1 selesai di catatan E2E

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"

git fetch origin && git rebase origin/main
npm test 2>&1 | tail -20   # pastikan rebase tak merusak apa pun
git push -u origin zihar/zihar/fix/drawing-subbar-anchor
```

Buka PR dengan `gh pr create --base main`. Deskripsinya harus memuat:
- angka sebelum → sesudah (`112/163` → hasil Step 1),
- hasil spike Task 0 (Δpreview `rayLine`, dan apakah mode drag ikut membaik),
- **daftar eksplisit test yang masih merah dan alasannya** (Temuan 2, 3, 4) — supaya reviewer tak membacanya sebagai kegagalan,
- apakah verifikasi manual magnet Task 6 Step 4 dijalankan atau dilewati.
