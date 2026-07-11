# B4 Esc-Deselect Objek — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menekan Escape men-deselect objek gambar yang sudah jadi (handle seleksi hilang), bukan hanya membatalkan gambar in-progress.

**Architecture:** Tambah helper `deselectOverlay()` yang membersihkan state seleksi internal klinecharts 9.8.10 via `OverlayStore.setClickInstanceInfo(instance:null)` (memicu `onDeselected` yang sudah ada + re-render). Sisipkan cabang `else if(selectedId)` pada handler Escape yang ada, dengan prioritas di bawah pembatalan gambar in-progress.

**Tech Stack:** Vanilla JS di `index.html` monolitik + klinecharts 9.8.10 (di-pin via unpkg UMD). Tanpa unit test — verifikasi manual di browser (konvensi CLAUDE.md).

## Global Constraints

- Semua perubahan di satu file: `index.html`. Satu fitur = satu PR (CLAUDE.md).
- Teks UI berbahasa Inggris; komentar kode & commit boleh Indonesia (CLAUDE.md).
- Tanpa unit test frontend — verifikasi manual via browser (`PORT=8765 ./luna-trade`, butuh login OANDA untuk memuat candle & menggambar).
- Jangan upgrade/ubah versi klinecharts. Jalur internal `getChartStore().getOverlayStore().setClickInstanceInfo` valid khusus untuk `@9.8.10` yang di-pin — bungkus `try/catch` + fallback `selectedId=null`.
- Referensi lengkap: `docs/superpowers/specs/2026-07-11-esc-deselect-object-design.md`.

---

### Task 1: Helper `deselectOverlay()` + cabang Escape deselect

**Files:**
- Modify: `index.html:3976` (sisip helper `deselectOverlay()` tepat setelah `disarmIcons()`)
- Modify: `index.html:5679` (cabang `else if(e.key==='Escape')` — tambah `else if(selectedId)`)

**Interfaces:**
- Consumes (global yang sudah ada): `chart` (instance klinecharts), `selectedId` (deklarasi `index.html:3975`), `inProgressId`, `pendingClicks`, `disarmIcons()`, `hideMagDot()`.
- Consumes (API internal klinecharts): `chart.getChartStore().getOverlayStore().setClickInstanceInfo(info, event)`.
- Produces: fungsi global `deselectOverlay()` — tanpa argumen, tanpa nilai balik; efek samping: melepas seleksi overlay aktif + set `selectedId=null`. Callback `onDeselected` yang ada (`index.html:4029`) otomatis ikut mereset `selectedId`, `hideAddTextNow()`, `posRerender()`.

- [ ] **Step 1: Sisip helper `deselectOverlay()` setelah `disarmIcons()` (baris 3976)**

Tambahkan blok berikut PERSIS di baris baru setelah definisi `disarmIcons()`:

```js
// Lepas seleksi objek gambar yang sudah jadi (Esc). selectedId=null saja TAK cukup: klinecharts
// menyimpan state seleksi di OverlayStore._clickInstanceInfo (inilah yang menggambar handle). Bersihkan
// lewat setClickInstanceInfo(instance:null) → memicu onDeselected (yang mereset selectedId) + re-render pane.
// Jalur internal ini valid utk klinecharts@9.8.10 yang di-pin; try/catch + fallback jaga-jaga bila berubah.
function deselectOverlay(){
  try{
    chart.getChartStore().getOverlayStore().setClickInstanceInfo(
      {paneId:'', instance:null, figureType:0, figureKey:'', figureIndex:-1, attrsIndex:-1}, {}
    );
  }catch(_){}
  selectedId=null;
}
```

- [ ] **Step 2: Tambah cabang deselect pada handler Escape (baris 5679)**

Ganti baris 5679 yang berbunyi:

```js
  else if(e.key==='Escape'){ if(inProgressId){ try{chart.removeOverlay(inProgressId);}catch(_){} inProgressId=null; pendingClicks=[]; disarmIcons(); try{hideMagDot();}catch(_){} } }
```

menjadi (tambah cabang `else if(selectedId)` — prioritas in-progress tetap di atas):

```js
  else if(e.key==='Escape'){ if(inProgressId){ try{chart.removeOverlay(inProgressId);}catch(_){} inProgressId=null; pendingClicks=[]; disarmIcons(); try{hideMagDot();}catch(_){} } else if(selectedId){ deselectOverlay(); } }
```

- [ ] **Step 3: Cek sintaks tanpa menjalankan server**

Run: `node --check index.html 2>&1 | head` — TIDAK berlaku (index.html bukan JS murni). Sebagai gantinya ekstrak & cek balans dengan grep cepat:

Run: `grep -c "function deselectOverlay" index.html`
Expected: `1`

Run: `grep -c "else if(selectedId){ deselectOverlay(); }" index.html`
Expected: `1`

- [ ] **Step 4: Verifikasi manual di browser**

Prasyarat: `PORT=8765 ./luna-trade` jalan (butuh `.env` OANDA) + login OANDA agar candle & menggambar aktif. Buka `http://localhost:8765`.

Jalankan 5 skenario dari spec dan konfirmasi hasilnya:
1. Gambar trendline → klik pilih (handle tampil) → **Esc** → handle hilang, garis TETAP ada.
2. Pilih objek → **Esc** → tekan **Delete** → tak ada yang terhapus. Lalu pilih lagi → **Delete** → terhapus (jalur Delete normal, tak regresi).
3. Mulai menggambar (klik titik pertama, in-progress) → **Esc** → gambar in-progress batal (perilaku lama utuh).
4. Klik-kanan objek (object popup terbuka) saat objek terpilih → **Esc** → popup tertutup DAN objek ter-deselect (sekali tekan).
5. DevTools console: tanpa error JS selama langkah 1–4.

Catatan bila OANDA tak tersedia: minimal pastikan tak ada error JS saat load & `deselectOverlay` terdefinisi (`typeof deselectOverlay==='function'` di console); verifikasi visual penuh ditangguhkan sampai ada login (lapor jelas bila ditangguhkan).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(draw): Esc men-deselect objek gambar yang sudah jadi

Tambah deselectOverlay() yang membersihkan state seleksi internal klinecharts
(OverlayStore.setClickInstanceInfo) + cabang Escape berprioritas (in-progress > deselect).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:** Helper `deselectOverlay()` (spec §"Helper baru") → Task 1 Step 1. Cabang Escape berprioritas (spec §"Perubahan pada cabang Escape") → Step 2. Interaksi popup "sekali tekan = keluar semua" → tak butuh kode baru (listener 5907 tetap; dicek di Step 4 skenario 4). 5 skenario verifikasi (spec §Verifikasi) → Step 4. Semua tercakup.

**2. Placeholder scan:** Tak ada TBD/TODO; semua kode ditampilkan utuh.

**3. Type consistency:** Nama fungsi `deselectOverlay` konsisten di Step 1/2/3. Payload `setClickInstanceInfo` cocok dengan bentuk default `_clickInstanceInfo` (spec). `selectedId` sesuai deklarasi baris 3975.
