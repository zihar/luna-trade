# Ctrl/⌘+C · Ctrl/⌘+V objek gambar (A3)

Tanggal: 2026-08-08 · Status: disetujui, siap dikerjakan

`Ctrl/⌘+C` menyalin objek gambar yang **terpilih** ke clipboard aplikasi; `Ctrl/⌘+V` menempatkan
salinannya **di posisi kursor**. Menu klik-kanan chart mendapat item **Paste** yang melakukan hal
sama di titik yang diklik. Melengkapi clone Ctrl+drag (PR #175/#177) yang hanya bisa menyalin ke
tempat yang bisa dijangkau satu gestur seret, pada instrumen yang sama.

## Yang terverifikasi dari TradingView (jangan riset ulang)

| Fakta | Sumber |
|---|---|
| "Copy selected object" = `Ctrl+C`, "Paste object" = `Ctrl+V` | `tradingview.com/charting-library-docs/latest/getting_started/Shortcuts/` |
| Berlaku untuk objek gambar apa pun, `⌘` di Mac | akun resmi TV, `x.com/tradingview/status/1467669276916125706` |
| Ada item **Paste** di menu klik-kanan chart (bukan hotkey saja) | idem, hasil pencarian dokumentasi/blog TV |
| Clone = objek **dipilih** dulu lalu Ctrl+drag | `.../43000537251-how-to-clone-drawings` (lihat `2026-08-08-clone-butuh-terpilih-design.md`) |

**Tidak terdokumentasi di mana pun:** ke mana persisnya objek hasil paste mendarat, dan apakah ia
langsung terpilih. Halaman clone, daftar shortcut engine, dan halaman hotkey desktop sudah dicek —
semuanya diam soal ini. Keputusan di bawah karena itu **pilihan kita**, diambil supaya konsisten
dengan item menu klik-kanan TV (paste di titik yang ditunjuk), bukan klaim tentang perilaku TV.

## Keputusan

| Pertanyaan | Keputusan | Alasan |
|---|---|---|
| Sumber salinan | hanya objek **terpilih** (`selectedId`) | sesuai dokumentasi TV, dan konsisten dengan koreksi clone di PR #177. Hover **tidak** dipakai walau `Delete` memakainya — menyalin objek yang cuma kelewatan kursor tak punya niat di baliknya |
| `Ctrl/⌘+X` | **tidak** ada | tak ada di daftar shortcut TV; `Ctrl+C` lalu `Delete` sudah setara |
| Penempatan `Ctrl/⌘+V` | **titik ke-1 objek mendarat di kursor** | satu-satunya penempatan yang konsisten dengan item menu klik-kanan; "paste ke tempat yang saya tunjuk" |
| Bentuk dipertahankan dalam satuan apa | **offset piksel** antar titik, direkam saat `Ctrl+C` | lihat "Geometri" di bawah — ini keputusan paling menentukan di spec ini |
| Lingkup clipboard | satu variabel di **memori**, hidup selintas sesi, **lintas instrumen & TF** | memindahkan pola gambar antar pasangan adalah kasus pakai utamanya. Aman justru karena penempatan = kursor: harga/waktu asal tak pernah dipakai |
| Bertahan lewat reload | **tidak** | clipboard yang mengingat objek dari kemarin mengagetkan, untungnya tipis |
| Kursor di luar chart saat `Ctrl+V` | jatuh ke **tengah area chart yang terlihat** | "posisi asal" bisa tak ada di layar (bahkan tak ada di data instrumen ini) setelah lintas-instrumen disetujui, jadi offset-dari-asal punya kasus di mana ia menaruh objek di tempat tak terlihat. Tengah chart selalu terlihat, dan cuma satu aturan |
| Paste berulang tanpa menggerakkan mouse | **menumpuk**, tak ada offset otomatis | konsekuensi jujur dari "di kursor"; offset otomatis justru membuat paste pertama meleset dari yang ditunjuk |
| Objek hasil paste | **ikut terpilih** | langsung bergagang & siap diseret/di-style, seperti objek yang baru selesai digambar |
| Warisan `lock` | hasil paste **tidak terkunci** | menyalin objek terkunci tetap boleh (menyalin tak mengubah apa pun), tapi salinan yang lahir terkunci hanya menjebak |
| Umpan balik saat `Ctrl+C` | **tanpa toast** | TV tak memberi umpan balik apa pun; item **Paste** di menu klik-kanan yang menyala/redup sudah jadi penandanya |
| Yang ikut tersalin | `name`, geometri, gaya per objek (`objStyle`), `styles`, teks (`extendData`) | sama persis dengan daftar milik clone — tanpa gaya & teks, "salinan" bukan salinan |

## Geometri: kenapa offset PIKSEL

Titik objek disimpan sebagai anchor data (`{timestamp,value}` atau `{dataIndex pecahan,value}`),
bukan piksel. `cloneOverlay()` yang ada tak pernah perlu menjawab "bentuk diukur dalam satuan apa"
karena ia menyalin **di tempat**. Paste-di-kursor memindahkan titik, jadi ia harus menjawabnya.

Tiga kandidat, dan kenapa yang dipilih menang:

- **Offset piksel (dipilih).** Saat `Ctrl+C`, rekam `{dx,dy}` tiap titik relatif titik ke-1 dalam
  piksel layar. Saat paste, titik-k = kursor + `{dx,dy}`, lalu tiap titik dikonversi balik ke
  anchor lewat jalur yang **sama persis** dengan `instantDropPoint`: `subBar(name)` →
  `fracAnchorFromPx` (dataIndex pecahan), selain itu `xAnchorFromPx`; nilai harga dari `pxToValue`.
  Satu aturan untuk semua kasus — instrumen sama, instrumen lain, TF lain, zoom berubah.
- **Delta data (selisih bar & selisih harga).** Identik dengan pilihan di atas selama instrumen &
  TF sama, tapi lintas instrumen delta harganya omong kosong: garis EUR setinggi `0.0050` di-paste
  ke XAU jadi garis rata tak terlihat. Bertabrakan langsung dengan keputusan lintas-instrumen.
- **Hibrida** (data space bila instrumen+TF sama, piksel bila beda). Menutup celah di atas dengan
  ongkos dua jalur geometri yang dua-duanya harus diuji, untuk kasus yang jalur piksel sudah
  tangani benar.

"Paste di kursor" sendiri adalah konsep ruang-layar; mengukur bentuknya di ruang yang sama membuat
hasilnya bisa ditebak — **apa yang terlihat saat disalin, itu yang mendarat**.

**Konsekuensi yang diterima, bukan cacat:** salin trendline, zoom out jauh, lalu paste → salinannya
mencakup lebih banyak bar daripada aslinya. Itu benar menurut aturan di atas (ia mendarat seperti
yang terlihat), tapi inilah titik yang paling mungkin terasa aneh bagi pengguna, dan sudah
disepakati di muka.

## Arsitektur

Modul baru **`js/draw-copy-paste.js`**, pola sama dengan `draw-constrain.js` / `draw-clone.js` /
`magnet-temp.js`: satu gestur = satu modul, disisipkan lewat gerbang kecil di pemanggilnya.

```
copyOverlay()            baca selectedId → isi drawClip {name, styles, extendData, objStyle, off[]}
pasteOverlayAt(px,py)    drawClip + titik kontainer → titik anchor → cloneOverlay(src, pts) → pilih
```

Paste **memakai ulang badan `cloneOverlay`** — argumen `pts`-nya memang sudah dirancang untuk
dioper dari luar, dan lewat situ salinan ikut mendapat `delHooks()` sehingga bukan objek kelas dua:
drag presisi sub-bar, magnet, kunci sudut, dan simpan-otomatis berlaku sama.

Satu penyesuaian diperlukan. `cloneOverlay(id, pts)` sekarang membaca sumbernya lewat
`chart.getOverlayById(id)`, sedangkan clipboard bisa **hidup lebih lama dari objeknya** — objek
aslinya dihapus, atau instrumen berganti sehingga overlay-nya sudah tak ada. Karena itu
`cloneOverlay` dipecah jadi:

- `cloneOverlay(id, pts)` — tetap ada, tanda tangan tak berubah; kini cuma membaca objek `id` jadi
  deskripsi lalu meneruskan (pemanggil lama di `draw-tools.js` tak tersentuh);
- `createFromDesc(desc, pts)` — inti yang sebenarnya membuat overlay dari *deskripsi* (`name`,
  `styles`, `extendData`, `objStyle`). Ini yang dipakai paste, dengan deskripsi dari `drawClip`.

Dua hal yang **harus** dikerjakan paste sendiri karena clone mendapatkannya dari drag:

- `scheduleSaveDraws()` — tanpa ini objek hilang saat reload dan `Ctrl+Z` tak bisa membatalkannya.
- pemilihan objek baru — kebalikan `deselectOverlay()`, lewat
  `getOverlayStore().setClickInstanceInfo({paneId:'candle_pane', instance:<instance objek baru>, …})`.
  Jalur internal klinecharts@9.8.10 yang di-pin, sama seperti yang sudah dipakai `Esc`; dibungkus
  `try/catch` — bila internal itu berubah, paste tetap jadi, hanya tak terpilih.

### Titik sentuh

| Berkas | Perubahan |
|---|---|
| `js/draw-copy-paste.js` (baru) | `drawClip`, `copyOverlay()`, `pasteOverlayAt(px,py)` |
| `js/draw-clone.js` | `cloneOverlay` menerima deskripsi objek (bukan id) supaya bisa dipakai clipboard |
| `js/keyboard.js` cabang `Ctrl/⌘` | `c` → `copyOverlay()`, `v` → paste di `lastPtr` (gerbang `ptrOverChart`, fallback tengah chart) |
| `js/context-menu.js` | item **Paste**, nonaktif bila clipboard kosong; menempel di titik klik-kanan |
| `index.html` | `<script src="/js/draw-copy-paste.js">` **sesudah** `draw-clone.js` |
| `tests/smoke/boot-integrity.spec.js` | entri `SENTINEL` untuk modul baru — tanpa ini smoke merah |

Tak ada baris `TOOL_SPEC`: ini gestur, bukan tool gambar baru.

## Jebakan

- **Gerbang "kursor di luar chart" WAJIB `ptrOverChart`**, bukan membandingkan `lastPtr` dengan
  `getBoundingClientRect()`. `lastPtr` hanya di-update `mousemove` **di dalam** `#chart`, jadi ia
  tak pernah berisi koordinat di luar dan cek rect tak akan pernah gugur — persis Temuan 4 E2E yang
  sudah membuat fallback `instantDropPoint` jadi kode mati sekali.
- **`Ctrl+C` saat ada teks terseleksi di halaman** → jangan intersepsi, biarkan browser menyalin
  teks. Menyalin harga dari panel trades tak boleh diam-diam berubah jadi menyalin objek gambar.
- **`<textarea>` editor teks objek** sudah aman tanpa kode tambahan: `js/keyboard.js` keluar lebih
  dulu untuk `INPUT/SELECT/TEXTAREA`.
- **Pemetaan `Ctrl`+klik → `contextmenu` di macOS tidak relevan di sini** (ini gestur keyboard),
  jadi `js/context-menu.js` tak butuh gerbang baru — item Paste dipasang di menu yang sudah ada.
- Objek dengan jumlah titik > 2 (channel, fib, posisi) ikut lewat jalur yang sama: offset direkam
  per titik, jadi tak ada perlakuan khusus per tool.

## Verifikasi

`tests/drawing/83-copy-paste.spec.js`:

1. Pilih trendline → `Ctrl+C`, gerakkan mouse, `Ctrl+V` → jadi **2** objek; yang baru berbentuk &
   sepanjang sama, titik ke-1-nya di posisi kursor (toleransi ≤1px, kebijakan opsi A).
2. `⌘+C`/`⌘+V` → sama (modifier alternatif benar-benar terbaca).
3. `Ctrl+V` **tanpa** copy sebelumnya → tak terjadi apa-apa (jumlah objek tetap).
4. `Ctrl+C` **tanpa** objek terpilih → clipboard tetap kosong; `Ctrl+V` sesudahnya tak membuat apa pun.
5. Salinan mewarisi **gaya** (warna) dan **teks** (`extendData`).
6. Paste **dua kali** di dua posisi berbeda → 3 objek, masing-masing di tempatnya.
7. Objek hasil paste **selamat dari reload** (bukti `scheduleSaveDraws` terpanggil) dan **`Ctrl+Z`**
   sesudah paste mengembalikannya ke jumlah semula.
8. Menu klik-kanan: item **Paste** redup saat clipboard kosong, aktif setelah copy, dan menempatkan
   objek di titik yang diklik-kanan.
9. Objek hasil paste **terpilih** — bisa langsung dihapus dengan `Delete` tanpa klik lebih dulu.

Sebelum push: `npx playwright test tests/smoke --project=hermetic` (itu juga yang dijalankan CI di
PR). Suite penuh diserahkan ke CI saat push ke `main`.

## Di luar cakupan

- **Item "Copy" di menu klik-kanan objek.** TV punya, Luna tidak bisa menyisipkannya: klik-kanan
  objek di Luna **langsung** membuka modal Style (`js/context-menu.js:41`), tak ada menu untuk
  disisipi. Membongkar interaksi itu adalah PR sendiri.
- Salin **banyak objek sekaligus** — Luna belum punya multi-select sama sekali.
- Clipboard lintas-tab / lintas-perangkat, dan integrasi ke clipboard OS.
- A5 alert dari objek gambar (menyentuh `alert_monitor.go`) — item backlog berikutnya.
