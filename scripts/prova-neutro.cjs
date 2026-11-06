// Prova di neutralità: l'export senza modifiche deve essere identico, byte per byte, al file importato;
// dopo taglio+elimina i campioni tenuti devono restare identici (tranne i 3 ms di declick sui bordi tagliati).
// Serve un server locale sulla cartella del repo (es. `python3 -m http.server 8765`) e Playwright.
//   node scripts/prova-neutro.cjs
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'neutro-'));
function scriviWav(nome, sr, ch, bit, sec) {
  const n = sec * sr * ch, bps = bit / 8, d = Buffer.alloc(n * bps);
  let seme = 12345; const rnd = () => (seme = (seme * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < n; i++) {
    if (bit === 16) d.writeInt16LE((rnd() % 65536) - 32768, i * 2);
    else { const v = (rnd() % 16777216) - 8388608; d.writeIntLE(v, i * 3, 3); }
  }
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + d.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * ch * bps, 28); h.writeUInt16LE(ch * bps, 32);
  h.writeUInt16LE(bit, 34); h.write('data', 36); h.writeUInt32LE(d.length, 40);
  fs.writeFileSync(path.join(T, nome), Buffer.concat([h, d]));
}
const dati = (b) => { let o = 12; while (o < b.length) { const id = b.toString('latin1', o, o + 4), sz = b.readUInt32LE(o + 4); if (id === 'data') return b.subarray(o + 8, o + 8 + sz); o += 8 + sz + (sz & 1); } };
const fmt = (b) => ({ ch: b.readUInt16LE(22), sr: b.readUInt32LE(24), bit: b.readUInt16LE(34) });
let fallite = 0;
const verifica = (ok, msg) => { console.log((ok ? '  ok   ' : '  FALLITO ') + msg); if (!ok) fallite++; };

async function prova(nome, bit) {
  const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8765/index.html?debug'); await p.waitForSelector('html[data-pronto]');
  await p.setInputFiles('#file', path.join(T, nome)); await p.waitForTimeout(1500);
  const orig = fs.readFileSync(path.join(T, nome)), fo = fmt(orig), od = dati(orig), fb = fo.ch * fo.bit / 8;
  const esporta = async () => {
    await p.click('#esporta'); await p.selectOption('#e-bit', String(bit));
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#e-vai')]);
    await dl.saveAs(path.join(T, 'out.wav')); return fs.readFileSync(path.join(T, 'out.wav'));
  };
  console.log(nome);
  let out = await esporta();
  verifica(Buffer.compare(od, dati(out)) === 0, 'senza modifiche: identico byte per byte');
  await p.evaluate(() => { window.__S.t = 2; }); await p.click('#b-taglia');
  await p.evaluate(() => { window.__S.t = 3; }); await p.click('#b-taglia');
  await p.evaluate(() => { window.__S.sel = window.__S.clips.find((c) => Math.abs(c.start - 2) < 1e-9).id; }); await p.click('#b-elimina');
  out = await esporta(); const xd = dati(out);
  const f2 = fo.sr * 2, f3 = fo.sr * 3, dc = Math.round(fo.sr * 0.003);
  const diff = (a0, b0, n) => { let k = 0; for (let i = 0; i < n * fb; i++) if (od[a0 * fb + i] !== xd[b0 * fb + i]) k++; return k; };
  verifica(xd.length / fb === od.length / fb - fo.sr, 'dopo il taglio: durata giusta (1 s in meno)');
  verifica(diff(0, 0, f2 - dc) === 0, 'prima del taglio: campioni identici');
  verifica(diff(f3 + dc, f2 + dc, od.length / fb - f3 - dc) === 0, 'dopo il taglio: campioni identici');
  verifica(!errs.length, 'nessun errore nella pagina');
  await b.close();
}
(async () => {
  scriviWav('n16_441_st.wav', 44100, 2, 16, 6); scriviWav('n24_48_mono.wav', 48000, 1, 24, 6);
  await prova('n16_441_st.wav', 16); await prova('n24_48_mono.wav', 24);
  fs.rmSync(T, { recursive: true, force: true });
  console.log(fallite ? `\n${fallite} prove FALLITE` : '\nTutte le prove di neutralità passano.');
  process.exit(fallite ? 1 : 0);
})();
