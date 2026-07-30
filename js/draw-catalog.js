const DRAW_GROUPS=[
  {key:'cursor', title:'Cursor', cursor:true, tools:[
    {name:'cross', title:'Cross', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v18M3 12h18"/></svg>'},
    {name:'dot', title:'Dot', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>'},
    {name:'arrow', title:'Arrow (no crosshair)', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 3l6 16 2-6 6-2z"/></svg>'},
    {name:'eraser', title:'Eraser (click object to delete)', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 15l6-6 8 8-3 3H9zM14 5l5 5"/></svg>'},
  ]},
  {key:'trend', title:'Trend Lines', tools:[
    {name:'trendline', sc:'T', title:'Trend Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="1.7"/><circle cx="20" cy="4" r="1.7"/></svg>'},
    {name:'rayLine', sc:'Y', title:'Ray', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="20" x2="22" y2="2"/><circle cx="4" cy="20" r="1.7"/></svg>'},
    {name:'straightLine', sc:'E', title:'Extended Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="2" y1="22" x2="22" y2="2"/></svg>'},
    {name:'horizontalStraightLine', sc:'H', title:'Horizontal Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="12" x2="21" y2="12"/><circle cx="12" cy="12" r="1.6"/></svg>'},
    {name:'horizontalRayLine', title:'Horizontal Ray', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="12" x2="22" y2="12"/><circle cx="4" cy="12" r="1.7"/></svg>'},
    {name:'verticalStraightLine', sc:'V', title:'Vertical Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="12" y1="3" x2="12" y2="21"/><circle cx="12" cy="12" r="1.6"/></svg>'},
    {name:'priceLine', sc:'P', title:'Price Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="9" x2="21" y2="9" stroke-dasharray="3 3"/><path d="M3 15h10"/></svg>'},
  ]},
  {key:'channel', title:'Channels', tools:[
    {name:'parallelStraightLine', title:'Parallel Channel', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="17" x2="21" y2="7"/><line x1="3" y1="21" x2="21" y2="11"/></svg>'},
    {name:'priceChannelLine', title:'Price Channel', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="16" x2="21" y2="8"/><line x1="3" y1="20" x2="21" y2="12"/><line x1="3" y1="12" x2="21" y2="4"/></svg>'},
  ]},
  {key:'fib', title:'Fibonacci', tools:[
    {name:'fib3', sc:'F', title:'Fib Retracement', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>'},
    {name:'fibonacciLine', title:'Fib Line', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="5" x2="20" y2="5"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="4" y1="20" x2="20" y2="20"/></svg>'},
  ]},
  {key:'shapes', title:'Shapes', tools:[
    {name:'rect', sc:'R', title:'Rectangle', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="6" width="16" height="12" rx="1.5"/></svg>'},
    {name:'circle', sc:'O', title:'Circle', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/></svg>'},
    {name:'ellipse', title:'Ellipse', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="12" cy="12" rx="9" ry="6"/></svg>'},
    {name:'arrow', sc:'A', title:'Arrow', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="20" x2="20" y2="4"/><path d="M20 4v6M20 4h-6"/></svg>'},
    {name:'arrowMarkUp', title:'Arrow Mark Up', svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l6 8h-4v10h-4V11H6z"/></svg>'},
    {name:'arrowMarkDown', title:'Arrow Mark Down', svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21l6-8h-4V3h-4v10H6z"/></svg>'},
  ]},
  {key:'positions', title:'Positions', tools:[
    // Long/Short monokrom: arah = siluet dominan (bukan detail mungil spt ikon lama). Dua sinyal:
    // panah naik dari lantai (long) vs turun dari langit-langit (short) + posisi baseline (bawah vs atas).
    {name:'longPosition', pos:'long', title:'Long Position', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20.5h16"/><path d="M12 17.5V6"/><path d="M7 11 12 6l5 5"/></svg>'},
    {name:'shortPosition', pos:'short', title:'Short Position', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3.5h16"/><path d="M12 6.5V18"/><path d="M7 13 12 18l5-5"/></svg>'},
    {name:'dateRange', title:'Date Range', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 5 V19 M18 5 V19 M9 12 h6 M9 12 l2 -2 M9 12 l2 2 M15 12 l-2 -2 M15 12 l-2 2"/></svg>'},
  ]},
  // Measure (ruler): alat ukur EPHEMERAL — dapat baris rail sendiri, bukan numpang di grup
  // Positions, supaya memakainya tak mengubah arti tombol grup itu (lastToolOf).
  {key:'measure', title:'Measure', tools:[
    {name:'measure', sc:'M', title:'Measure', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 9h18v6H3z"/><path d="M7 9v3M11 9v3M15 9v3M19 9v3"/></svg>'},
  ]},
  {key:'text', title:'Text', tools:[
    {name:'text', sc:'X', title:'Text', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 6 h14 M12 6 V19"/></svg>'},
    {name:'callout', title:'Callout', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 16l-2 4 6-4"/></svg>'},
    // simpleAnnotation ("Annotation") & simpleTag ("Tag") DITARIK dari rail 2026-07-27 (Temuan 3
    // E2E). Keduanya overlay BAWAAN klinecharts yang menandai semua figure-nya `ignoreEvent:true`
    // dan tak punya handle default → hit-test tak pernah kena → sekali tergambar objeknya tak bisa
    // di-hover, dipilih, di-drag, dihapus lewat klik/Delete, atau dibuka setting-nya; satu-satunya
    // jalan keluar Undo atau trash (hapus semua). Itu desain upstream untuk anotasi PROGRAMATIK,
    // bukan objek yang digambar & disunting user, jadi memakainya sebagai tool gambar salah tempat.
    // Tak diperbaiki karena keduanya redundan dengan tool yang sudah bekerja penuh:
    // simpleTag ≈ priceLine (garis + penanda harga di sumbu Y), simpleAnnotation ≈ callout /
    // arrowMarkUp-Down (teks berpointer & penanda di bar). Kalau suatu saat mau dihidupkan lagi,
    // harus didaftarkan ulang sendiri tanpa `ignoreEvent` + masuk DRAW_DEFAULT + ikut jalur editor
    // teks inline — lihat docs/e2e-drawing-findings.md (Temuan 3). Dijaga oleh test di
    // tests/drawing/50-rail.spec.js agar tak diam-diam kembali.
  ]},
];
const TRASH_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>';
