# B4 — Escape men-deselect objek gambar (design)

**Tanggal:** 2026-07-11
**Scope:** `index.html` saja · satu PR kecil (konvensi CLAUDE.md: satu fitur = satu PR)
**Asal:** backlog P1 dari plan `~/.claude/plans/aku-mau-kamu-analisa-memoized-brooks.md` (item B4). Dulu ditunda karena `selectedId=null` tak cukup men-deselect secara visual.

## Masalah

Menekan **Esc** saat ini (baris ~5679) hanya membatalkan gambar yang sedang berlangsung
(`inProgressId`). Objek gambar yang **sudah jadi** dan sedang terpilih (handle/titik tampil)
tidak ikut ter-deselect. Ini menyimpang dari ekspektasi ala TradingView di mana Esc = "lepaskan seleksi".

Menyetel `selectedId=null` saja **tidak cukup**: klinecharts 9.8.10 menyimpan state seleksi
di internal `OverlayStore._clickInstanceInfo` — inilah yang menyebabkan handle/titik objek
tergambar. Tanpa membersihkan state itu, handle tetap tampil meski `selectedId` sudah null.

## Mekanisme deselect (hasil de-risk terhadap sumber klinecharts 9.8.10)

Jalur berikut publik-terjangkau dari instance `chart` dan stabil untuk versi yang kita pin (`@9.8.10`):

```js
chart.getChartStore().getOverlayStore().setClickInstanceInfo(infoKosong, {})
```

- `ChartImp.getChartStore()` → `ChartStore.getOverlayStore()` → `OverlayStore.setClickInstanceInfo(info, event)`.
- Memanggil dengan `info.instance = null` akan: (a) memicu callback `onDeselected` pada objek
  yang sebelumnya terpilih, dan (b) `chart.updatePane(Overlay, …)` sehingga handle seleksi
  hilang dari render.
- `infoKosong` mereplikasi bentuk default `_clickInstanceInfo`:
  `{paneId:'', instance:null, figureType:0, figureKey:'', figureIndex:-1, attrsIndex:-1}`.
- `event` boleh `{}` — hanya di-spread ke argumen callback.

Handler `onDeselected` yang sudah ada (baris ~4029) sudah membereskan sisi aplikasi:
`selectedId=null`, `hideAddTextNow()`, `posRerender(overlay)`. Jadi memicu jalur deselect
klinecharts otomatis menjaga state aplikasi tetap konsisten.

## Desain

### Helper baru: `deselectOverlay()`

```js
// Lepas seleksi objek gambar yang sudah jadi. selectedId=null saja tak cukup — klinecharts
// menyimpan state seleksi di OverlayStore._clickInstanceInfo (yang menggambar handle). Bersihkan
// via setClickInstanceInfo(instance:null) → memicu onDeselected (yang mereset selectedId) + re-render.
function deselectOverlay(){
  try{
    chart.getChartStore().getOverlayStore().setClickInstanceInfo(
      {paneId:'', instance:null, figureType:0, figureKey:'', figureIndex:-1, attrsIndex:-1}, {}
    );
  }catch(_){}
  selectedId = null;   // fallback bila jalur internal berubah di versi lain
}
```

- `try/catch` melindungi bila API internal berubah; `selectedId=null` tetap dieksekusi sebagai jaring pengaman.

### Perubahan pada cabang Escape (baris ~5679)

Tambah cabang deselect setelah cabang in-progress, dengan **prioritas**:

1. **Sedang menggambar** (`inProgressId`) → batalkan gambar in-progress *(perilaku lama, tak berubah)*.
2. **Objek terpilih** (`selectedId`) → `deselectOverlay()` *(baru — B4)*.

```js
else if(e.key==='Escape'){
  if(inProgressId){ /* … batal gambar in-progress (tetap) … */ }
  else if(selectedId){ deselectOverlay(); }
}
```

Prioritas in-progress lebih tinggi karena pengguna sedang di tengah aksi menggambar.

### Interaksi dengan popup (keputusan: "sekali tekan = keluar semua")

Listener Escape terpisah di baris ~5907 (`hideObjPopup / hideFibPop / chartSet.remove`) **tetap apa adanya**.
Karena kedua listener menyimak tombol Escape yang sama, satu tekan Esc = popup tertutup **dan** objek
ter-deselect secara bersamaan. Tak perlu koordinasi antar-handler; tak ada konflik (cabang in-progress
dan deselect tak menyentuh DOM popup).

## Yang TIDAK dilakukan (YAGNI)

- Tidak ada "peel satu lapis per tekan" (Esc-1 tutup popup, Esc-2 deselect) — ditolak: rumit, untung kecil.
- Tidak menyentuh overlay posisi/paper selain efek deselect standar (handle hilang; posisi TIDAK terhapus).
- Tidak menambah API publik atau meng-upgrade klinecharts.

## Verifikasi (manual, browser)

Butuh login OANDA untuk memuat candle & menggambar. Server: `PORT=8765 ./luna-trade`.

1. Gambar objek (mis. trendline) → klik untuk memilih → handle tampil → tekan **Esc** → handle hilang, objek tetap ada.
2. Pilih objek → tekan **Esc** → tekan **Delete**: tak menghapus apa pun (karena `selectedId` sudah null). Lalu pilih lagi → **Delete** menghapus (regresi-check jalur Delete tetap normal).
3. Mulai menggambar (klik titik pertama, in-progress) → **Esc** → gambar in-progress batal (perilaku lama utuh).
4. Buka object popup (klik-kanan objek) sambil objek terpilih → **Esc** → popup tertutup DAN objek ter-deselect (sekali tekan).
5. Cek console: tanpa error JS.
