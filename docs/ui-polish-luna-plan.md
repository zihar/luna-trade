# Polish UI/UX Luna Trade + identitas "Luna"

> ## ✅ STATUS 2026-07-01 — SELESAI (divalidasi langsung ke kode)
> Hampir semua item plan ini sudah terpasang; dokumen di bawah (bertanggal 2026-06-30)
> sudah **usang**. Hasil validasi kode terkini:
>
> | Item | Status |
> |---|---|
> | A1 order ticket clip | ✅ Beres total (redesign order panel dua-mode simple↔expand, compact) |
> | A2 tabel Markets sesak | ✅ `.wl-head` flex+gap+bar aksen; `.wl-row` grid kolom rapi (Bid/Ask/Spread/Day Hi/Lo terpisah) |
> | A3 spread sintetik aneh | ✅ `maxSpread`+`clampSpread` di `hub.go` (dipanggil di broadcast) → entry/monitor/FE konsisten |
> | A4 header chart sekunder / OHLC wrap | ✅ legend dipendekkan (anti-wrap) |
> | B5 kontras header + hover | ✅ token `--hdr` + hover baris |
> | B6 empty-state in-voice | ✅ `.tp-empty` ikon ☾ + judul + hint |
> | B7 rapikan 2 bar atas / label "TF:" | ✅ label "TF:" sudah tak ada |
> | B8 focus-visible | ⚠️ sebagian (2 tempat) — bisa dilengkapi |
> | C9 brandmark bulan sabit | ✅ SVG crescent di logo kiri-atas |
> | C10 token `--luna-glow` + near-black dingin | ✅ `--luna-glow` (dark & light) |
> | C11 momen lunar di login | ✅ login: crescent + glow + tagline |
>
> **Sisa kecil:** B8 focus-visible dilengkapi. Selebihnya polish + identitas Luna DONE.

---

<details><summary>Arsip plan asli (2026-06-30, sudah usang)</summary>

## Context
Plan ditulis lalu disimpan; kemudian dicek ulang relevansinya karena ada commit baru
`11f5a3a feat(draw+ui): fix handle draw + redesign panel order` + perubahan
uncommitted (+101/−63 baris). Order panel — temuan headline — baru diredesign, jadi
plan divalidasi ulang ke render terkini (CDP, 4 state) + kode.

**Verdict: sebagian besar masih relevan; A1 turun jadi minor; anchor baris di-refresh.**

---

## Hasil re-validasi per item

| Item | Status |
|---|---|
| **A1 order ticket ke-clip docked** | ✅ Sebagian besar TERATASI oleh redesign. Baris one-click `SELL · stepper · BUY` muat penuh saat docked/collapsed. Sisa minor: saat di-*expand*, baris Stop Loss/Take Profit ke-clip di bawah. → polish kecil. |
| **A2 tabel Markets sesak** | ⚠️ MASIH VALID. Header "Ask Spread" nempel, Bid/Ask berdempet, Day Hi/Lo mepet tepi. |
| **A3 spread sintetik aneh** | ⚠️ MASIH VALID (XAU 1994, BTC 461). Akar: `renderWatch` (~2685) tampil `(sprd/pip).toFixed(1)`; live tick instrumen harga tinggi → spread $ kelebaran relatif pip. Fix kemungkinan di server Go (quote sintetik) / `pipOf`, bukan hanya index.html. |
| **A4 header chart sekunder** | ⚠️ MASIH VALID. Legend OHLC primer wrap 2 baris; sekunder pakai TF teks kecil (beda pill). |
| **B5–B8 polish visual** | ⚠️ MASIH VALID. |
| **C9–C11 identitas Luna** | ⚠️ MASIH VALID; belum dikerjakan, masih klon TradeLocker anonim. |

---

## Arah desain identitas "Luna" (Tier C)
Identitas via **spend boldness di satu tempat (brand + login), sisanya tenang** —
bukan recolor UI.
- **Color (brand saja):** `--green/--red/--accent` TETAP. Tambah `--luna-glow:#aeb9e8`
  + dinginkan near-black sangat tipis `#101013`→`#0f1015` (uji kontras candle).
- **Type:** Inter tetap utk data. Brand wordmark + hero login: treatment Inter lebih
  berkarakter (weight 700, tracking rapat). Tanpa webfont berat baru.
- **Signature:** brandmark bulan sabit + glow lembut di logo kiri-atas & satu momen
  lunar di login/empty-state. Selesai di sana (lepas satu aksesori).

---

## Pekerjaan (urut prioritas)

### Tier A
1. *(minor)* Expanded ticket clip — `.orderpanel[data-dock="docked"]` (baris 476) saat
   expand beri scroll/`max-height` agar SL/TP tak tertutup metric-bar. Floating sudah
   benar (baris 600). Collapsed jangan dirusak.
2. Tabel Markets sesak (`.wl-row` 346, `.wl-head` 341): naikkan `gap`, Spread lebar
   sendiri, padding kanan Day Hi/Lo, pisahkan label "Ask"/"Spread".
3. Spread sintetik realistis — telusuri sumber live spread (paper.go/hub.go/
   connector.go), skalakan per instrumen (XAU ~$0.3, BTC ~$10–30), jangan flat.
4. Header chart sekunder konsisten (pill TF) & cegah OHLC legend wrap.

### Tier B
5. Kontras header muted (`#89898b`→~`#a0a0a4`), hover/baris-terpilih, zebra halus.
6. Empty-state jadi ajakan in-voice & terpusat (Positions/Pending/Closed).
7. Rapikan dua bar atas: buang label "TF:", samakan tinggi & ritme.
8. Konsistensi stroke-weight ikon rail + focus-visible.

### Tier C
9. Brandmark crescent + glow di logo kiri-atas.
10. Token `--luna-glow` + dinginkan near-black tipis (`:root` baris 14; light 19–24).
11. Satu momen lunar di login overlay / empty-state utama.

---

## Critical files
- `index.html` — anchor terbaru: `:root` baris 14 & ~233–245; Markets `.wl-*` 341–366;
  grid 388–411; order panel `.orderpanel` 476 + floating 600; ticket `.op3-*`/
  `.op2-step` 492–545.
- **Go (A3):** `paper.go` / `hub.go` / `connector.go` — sumber bid/ask/spread live tick.
- Reuse token `:root`.

## Verifikasi
- Server `PORT=8765`. Screenshot CDP: `scratchpad/shot.mjs` + cookie `luna_session`
  (`cookies.txt`). Uji 4 state: default, panel terbuka, ticket expand (cek SL/TP tak
  ke-clip), split-2. Plus light mode (`body.light`) & no console error.

</details>
