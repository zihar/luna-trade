// ===================== Measure tool (ruler) — ephemeral =====================
// Alat ukur sekali pakai: memberi angka lalu hilang, tanpa meninggalkan objek. Beda dari semua
// tool gambar lain, ia TIDAK masuk PERSIST_DRAW & tidak mencemari history undo.
// Rancangan: docs/superpowers/specs/2026-07-31-measure-tool-design.md

// Statistik murni dari dua titik overlay. null bila salah satu titik belum punya harga atau waktu
// (mis. titik di area future tanpa data) → pemanggil menggambar kotak TANPA pill, bukan NaN.
function measureStats(p0, p1){
  if(!p0 || !p1 || p0.value==null || p1.value==null) return null;
  const t0=tsOf(p0), t1=tsOf(p1);
  if(t0==null || t1==null) return null;
  const dPrice=p1.value-p0.value;
  const dPct = p0.value ? dPrice/p0.value*100 : 0;
  // pip HANYA untuk instrumen yang speknya kita punya. Untuk saham (STOCK:…) instSpec() jatuh ke
  // input #pipSize dan akan mencetak "pip" yang tak punya arti di sana.
  const spec = INSTRUMENT[inst];
  const dPips = spec ? Math.abs(dPrice)/spec.pip : null;
  // bar dihitung di ruang INDEKS, jadi gap akhir pekan otomatis tak terhitung.
  const bars = Math.round(Math.abs(fidxOf(p1)-fidxOf(p0)));
  // durasi = rentang wall-clock NYATA, bukan bars × DUR (alasan sama dgn dateRange di
  // js/overlays-custom.js: bar MN panjangnya 28–31 hari, rata-rata tak pernah benar).
  return {dPrice, dPct, dPips, bars, ms:Math.abs(t1-t0)};
}
// [line1, line2] siap dirender. Teks Inggris (aturan CLAUDE.md).
function fmtMeasure(st){
  if(!st) return null;
  const p=fmtFor(inst, st.dPrice);
  const priceTxt = st.dPrice>=0 ? '+'+p : p;                       // fmtFor sudah membawa '-'
  const pctTxt = (st.dPct>=0?'+':'')+st.dPct.toFixed(2)+'%';
  const pipTxt = st.dPips!=null ? ' · '+st.dPips.toFixed(1)+' pips' : '';
  const barTxt = st.bars===1 ? '1 bar' : st.bars+' bars';
  return [priceTxt+' ('+pctTxt+')'+pipTxt, barTxt+' · '+fmtDur(st.ms)];
}
