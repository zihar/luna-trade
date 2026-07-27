# Undangan "+ Add text" pada Rect Kecil — Design

**Tanggal:** 2026-07-27
**Status:** Disetujui (brainstorming)
**Scope:** overlay `rect` saja — gating placeholder & hit-area-nya terhadap ukuran kotak
**Berkas tersentuh:** `index.html` (registrasi `rect` + `overPlaceholder`/`overlayTextAnchor`),
`tests/drawing/40-modal-text.spec.js`

## Masalah

Gambar rectangle kecil, lalu hover: label `+ Add text` lebih besar daripada kotaknya.
Bentuk aslinya tak terbaca lagi, dan badan serta handle-nya ketutupan label — kotaknya
jadi susah dilebarkan.

Sumbernya: dua ukuran tetap dipakai di atas objek yang ukurannya bebas.

1. **Visual** — `index.html:866`: saat `extendData` kosong dan objek di-hover/terpilih,
   figure teks `+ Add text` (12px, `AXIS_FONT` ≈ 66px lebar) digambar di titik tengah
   kotak tanpa memeriksa apakah kotaknya sanggup memuatnya.
2. **Hit-area** — `index.html:844` `overPlaceholder()`: klik dianggap "di atas label" bila
   kursor berada dalam **±55 × ±16 px** dari titik tengah — juga angka tetap. Kotak yang
   lebih kecil dari 110×32 px berarti *seluruh* badannya, termasuk handle sudut, terhitung
   sebagai area label; klik di sana menyalakan timer 220ms (`index.html:3235`) yang membuka
   editor teks inline.

Keduanya harus ditangani bersama. Menambal yang visual saja akan meninggalkan area hantu:
label tak tampak, tapi klik di tengah kotak kecil masih membuka editor teks — lebih buruk
daripada keadaan sekarang, karena penyebabnya tak lagi terlihat.

## Keputusan: satu ambang, kotak kecil bersih total

Kotak yang tak sanggup memuat label **tidak menampilkan undangan sama sekali**, dan
hit-area-nya mati bersamaan. Alternatif yang ditimbang dan ditolak:

- *Menyusut bertahap* (label → glyph `+` → hilang): dua ambang dan dua bentuk figure untuk
  satu masalah kecil.
- *Pindah label ke luar kotak* sebagai chip melayang: undangan selalu terlihat, tapi
  menambah elemen yang bertumpuk dengan objek lain dan label harga di chart padat.
- *Ukur lebar label otomatis* (`measureText`/`calcTextWidth`, bukan konstanta literal):
  ditolak — bukan karena string placeholder-nya tetap (string tetap tak membuat lebar
  RENDER-nya tetap), tapi karena mengukurnya tetap butuh tahu font yang dipakai
  (`AXIS_FONT`, `index.html:1303`), dan proyek ini sudah pernah mengganti font sebelumnya
  (mis. migrasi ke Sora/Inter Tight/Chivo Mono). Konstanta literal + komentar asal-usul angka tetap lebih
  sederhana: kalau font berubah lagi, `ADDTEXT_MIN_W/H` memang harus ditinjau ulang manual —
  sama seperti `measureText` juga akan perlu di-re-run, hanya bedanya konstanta literal tak
  diam-diam salah di production sebelum ada yang sadar.

Harga dari keputusan ini: untuk kotak kecil, petunjuk visual "kotak ini bisa diberi teks"
hilang. Jalannya tinggal double-click → modal tab **Text**, yang sudah berjalan hari ini
(`index.html:3241`, `DM_TEXT_OBJS`). Ini diterima sadar.

## Rancangan

### 1. Ambang

Konstanta baru di dekat `showAddTextHint` (`index.html:841`), dengan asal-usul angkanya
ditulis di komentar:

```js
// Undangan "+ Add text" hanya muat di kotak yang cukup besar: labelnya ~66px lebar pada
// 12px/AXIS_FONT, plus ~12px napas per sisi. Di bawah ini kotak dibiarkan bersih — lihat
// docs/superpowers/specs/2026-07-27-rect-addtext-small-box-design.md
const ADDTEXT_MIN_W = 90, ADDTEXT_MIN_H = 28;
const ADDTEXT_PAD   = 8;    // jarak aman hit-area label dari tepi/handle kotak
```

Ambangnya diuji terhadap ukuran **pixel**, bukan harga/waktu. Konsekuensi yang diinginkan:
zoom-out sampai kotak menyusut → label hilang sendiri; zoom-in → muncul lagi. Ukuran kotak
dalam satuan harga tak relevan bagi masalah yang ini — yang menutupi handle adalah pixel.

### 2. Gating visual

Cabang placeholder di `createPointFigures` rect (`index.html:865`) diberi syarat ukuran.
`w` dan `h` sudah tersedia di sana dari `subBarCoords`:

```js
else if(showAddTextHint(overlay) && w>=ADDTEXT_MIN_W && h>=ADDTEXT_MIN_H)
```

Teks nyata milik pengguna (`t!==''`, cabang di atasnya) **tidak** disentuh: itu konten,
bukan undangan, dan memotongnya akan menyembunyikan data yang sengaja ditulis.

### 3. Hit-area memakai ambang yang sama, dipotong ke dalam kotak

`overPlaceholder()` untuk rect:

- kotak lebih kecil dari ambang → `false`. Klik = pilih/geser seperti objek biasa.
- kotak cukup besar → area label = irisan `(±55, ±16)` dengan kotak yang di-inset
  `ADDTEXT_PAD`. Ini menutup kasus kotak **lebar tapi tipis** (mis. 300×30 px): labelnya
  muat, tapi toleransi vertikal ±16 (tinggi 32px) melampaui tinggi kotak, sehingga klik
  persis di handle tepi atas/bawah hari ini masih terhitung "tambah teks".

```js
function overPlaceholder(o){ try{
  const a=overlayTextAnchor(o); if(!a) return false;
  let hw=55, hh=16;
  if(o.name==='rect'){ const b=rectBoxPx(o); if(!b) return false;
    if(b.w<ADDTEXT_MIN_W || b.h<ADDTEXT_MIN_H) return false;   // kotak kecil: tak ada undangan → tak ada hit-area
    hw=Math.min(hw, b.w/2-ADDTEXT_PAD); hh=Math.min(hh, b.h/2-ADDTEXT_PAD); }
  return Math.abs(lastPtr.x-a.x)<=hw && Math.abs(lastPtr.y-a.y)<=hh;
}catch(e){ return false; } }
```

Pada ambang minimum (90×28) band yang bisa diklik jadi 74×12 px — setinggi label itu
sendiri, jadi tetap konsisten: yang bisa diklik kira-kira apa yang terlihat. `hw`/`hh` tak
perlu di-clamp ke nol: gerbang ukuran di atasnya sudah menjamin sisa positif.

Kedua jalur mengukur hal yang sama lewat sumber berbeda — figure memakai `coordinates`
canvas dari `subBarCoords`, hit-area memakai `convertToPixel(..., {absolute:true})`. Selama
keduanya CSS-pixel (dan sekarang begitu) ambang yang sama menghasilkan keputusan yang sama.
Kalau satu hari nanti skalanya menyimpang, gejalanya adalah area hantu yang justru mau
dihilangkan desain ini.

Yang benar-benar teruji dari dua jalur ini: hit-area-nya (`overPlaceholder`, lewat
`40-modal-text.spec.js`) dan — sejak temuan review perlu ditutup — gerbang visualnya
sendiri (`createPointFigures`, lewat diff screenshot di `41-addtext-visual-gate.spec.js`).
Test-test itu berada di 55×20 dan ~300×30 px, JAUH dari ambang 90×28 — bukan di
perbatasannya. Menguji bahwa kedua jalur SEPAKAT tepat di garis 90×28 (mis. satu jalur
bilang 89.6px, jalur lain bilang 90.1px, lalu keduanya masih menghasilkan keputusan yang
sama) butuh membandingkan posisi sub-pixel canvas sungguhan dengan output
`convertToPixel`, sesuatu yang tak bisa dijangkau dari DOM/E2E — jadi itu TETAP tak
teruji secara otomatis. Kalau suatu hari skalanya menyimpang, sinyalnya adalah area
hantu (klik "tambah teks" atau sebaliknya tepat di sekitar ambang) yang harus ditangkap
manual atau lewat laporan pengguna, bukan lewat suite ini.

### 4. Satu sumber konversi titik → pixel

`overlayTextAnchor()` (`index.html:3485`) sudah menghitung sudut rect dalam pixel client
(`pts[0]` dan `pts[4]` bila titiknya sudah mengembang jadi 8, atau `pts[1]` bila belum).
Ukuran kotak butuh konversi yang sama, jadi bagian itu dipecah jadi helper `rectBoxPx(o)`
yang mengembalikan `{cx, cy, w, h}` (atau `null` bila titik belum lengkap / konversi gagal),
dan cabang `rect` di `overlayTextAnchor` memakainya. Dua salinan logika sudut rect akan
menyimpang begitu representasi titiknya berubah lagi — itu sudah pernah terjadi saat rect
mengembang dari 2 titik jadi 8.

## Verifikasi

`npm test` (hermetik, tanpa `.env`/OANDA).

**Test lama harus tetap hijau.** `tests/drawing/40-modal-text.spec.js:161` menggambar rect
lewat `defaultTargets` — 24% × 31% ukuran chart, jauh di atas ambang — jadi jalur "klik
tengah → editor inline" tetap berlaku apa adanya. Kalau test ini merah, ambangnya salah,
bukan test-nya.

**Test baru** di berkas yang sama: rect kecil lewat
`drawTool(page,'rect',{targets:[{x:200,y:200},{x:255,y:220}]})` — 55×20 px, di bawah kedua
ambang — lalu

1. hover + klik di titik tengah kotak → `textarea.text-editor` **tidak** muncul (beri jeda
   melampaui timer 220ms sebelum memastikan, supaya bukan lolos karena keburu diperiksa);
2. objeknya masih ada dan tetap terpilih — klik tadi harus jatuh sebagai "pilih", bukan
   ditelan;
3. double-click di atasnya → modal terbuka di tab `text` (jalur `dblclickObject` +
   `.dmodal-scrim.show` yang sudah ada di berkas itu), membuktikan teks masih bisa
   ditambahkan;
4. `assertNoPageErrors(page)`.

**Manual** (`PORT=8765 ./luna-trade`): kotak besar kosong tetap menampilkan `+ Add text`
saat hover/terpilih dan kliknya membuka editor inline; kotak kecil bersih dan handle-nya
bisa ditarik untuk melebarkan; zoom-out pada kotak besar sampai menyusut → label hilang
sendiri.

## Di luar cakupan

- **`trendline`** (`index.html:979`) punya bug yang sama persis — label `Add text` ukuran
  tetap di titik tengah garis, garis pendek → meluber. Sengaja tak diikutkan atas keputusan
  pemilik pekerjaan; layak jadi PR terpisah bila laporannya muncul.
- **`callout`** (`index.html:922`) tak terkena: lebar kotaknya dihitung dari panjang teks
  placeholder, jadi kotak kosongnya tak pernah lebih kecil dari labelnya.
- Teks nyata yang meluber dari kotak kecil dibiarkan seperti sekarang (konten pengguna).
