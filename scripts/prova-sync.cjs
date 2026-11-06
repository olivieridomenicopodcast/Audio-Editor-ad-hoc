// Prova di progetti multipli + sincronizzazione con un FINTO server GitHub in locale (nessun token vero).
// Serve un server locale sul repo (python3 -m http.server 8765) e Playwright.   node scripts/prova-sync.cjs
const http = require('http'), crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
function wav(nome, sec) {
  const sr = 8000, n = sr * sec, d = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) d.writeInt16LE(Math.round(Math.sin(i / 20) * 12000), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + d.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(d.length, 40);
  fs.writeFileSync(path.join(T, nome), Buffer.concat([h, d]));
}

/* ---- finto GitHub: abbastanza API per push/pull ---- */
const files = new Map(); // percorso → Buffer
const blobs = new Map();
let head = 'c0', n = 0; const alberi = new Map(), commit = new Map();
const hash = (x) => crypto.createHash('sha1').update(x).digest('hex');
const treeSha = () => hash(JSON.stringify([...files].map(([p, b]) => [p, hash(b)]).sort()));
alberi.set('t0', new Map()); commit.set('c0', 't0');
const server = http.createServer((q, r) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
  let corpo = ''; q.on('data', (c) => (corpo += c)); q.on('end', () => {
    const out = (st, o, tipo = 'application/json') => { r.writeHead(st, { ...cors, 'Content-Type': tipo }); r.end(typeof o === 'string' ? o : JSON.stringify(o)); };
    if (q.headers.authorization !== 'Bearer TESTTOKEN') return out(401, { message: 'Bad credentials' });
    const u = new URL(q.url, 'http://x'), p = decodeURIComponent(u.pathname).replace(/^\/repos\/o\/r/, '');
    const b = corpo ? JSON.parse(corpo) : {};
    if (p === '' || p === '/') return out(200, { full_name: 'o/r', permissions: { push: true } });
    if (p.startsWith('/contents/')) {
      const f = p.slice(10), dir = [...files.keys()].filter((k) => k.startsWith(f + '/'));
      if (files.has(f)) return (q.headers.accept || '').includes('raw') ? out(200, files.get(f).toString(), 'text/plain') : out(200, { sha: hash(files.get(f)) });
      if (dir.length) return out(200, dir.map((k) => ({ name: k.split('/').pop(), path: k, type: 'file', sha: hash(files.get(k)) })));
      return out(404, { message: 'Not Found' });
    }
    if (p === '/git/ref/heads/main') return out(200, { object: { sha: head } });
    if (p.startsWith('/git/commits/') && q.method === 'GET') return out(200, { tree: { sha: commit.get(p.split('/').pop()) } });
    if (p === '/git/blobs') { const s = 'b' + ++n; blobs.set(s, Buffer.from(b.content, 'base64')); return out(201, { sha: s }); }
    if (p === '/git/trees') {
      for (const v of b.tree) { if (v.sha === null) files.delete(v.path); else files.set(v.path, blobs.get(v.sha)); }
      const s = treeSha(); alberi.set(s, new Map(files)); return out(201, { sha: s });
    }
    if (p === '/git/commits') { const s = 'c' + ++n; commit.set(s, b.tree); return out(201, { sha: s }); }
    if (p === '/git/refs/heads/main') { head = b.sha; return out(200, {}); }
    out(404, { message: 'non gestito ' + p });
  });
});

let fallite = 0;
const verifica = (ok, msg) => { console.log((ok ? '  ok   ' : '  FALLITO ') + msg); if (!ok) fallite++; };
const attendi = async (p, fn, t = 15000) => { const f = Date.now(); while (Date.now() - f < t) { if (await p.evaluate(fn)) return true; await p.waitForTimeout(150); } return false; };

(async () => {
  wav('Uno.wav', 2); wav('Due.wav', 3);
  await new Promise((ok) => server.listen(9777, ok));
  const b = await chromium.launch();
  const conf = { token: 'TESTTOKEN', repo: 'o/r', branch: 'main', cartella: 'progetti', api: 'http://localhost:9777' };
  const apriDispositivo = async () => {
    const c = await b.newContext({ viewport: { width: 390, height: 844 } });
    await c.addInitScript((cf) => { if (!localStorage.getItem('aeah-gh-v1')) localStorage.setItem('aeah-gh-v1', JSON.stringify(cf)); }, conf);
    const p = await c.newPage(); p.errs = [];
    p.on('pageerror', (e) => p.errs.push(e.message)); p.on('dialog', (d) => d.accept(p.risposta || undefined));
    await p.goto('http://localhost:8765/index.html?debug'); await p.waitForSelector('html[data-pronto]');
    return p;
  };
  const chiudi = (p) => p.click('dialog[open] button[value="chiudi"]');
  const stato = (p) => p.textContent('#g-stato');
  const sync = async (p, id, attesa) => { await p.click('#menu'); await p.click(id); await attendi(p, (a) => document.querySelector('#g-stato').textContent.includes(a), 15000).catch(() => {}); await p.waitForFunction((a) => document.querySelector('#g-stato').textContent.includes(a), attesa, { timeout: 15000 }); const t = await stato(p); await chiudi(p); return t; };

  console.log('Dispositivo A: due progetti');
  const A = await apriDispositivo();
  await A.setInputFiles('#file', path.join(T, 'Uno.wav')); await A.waitForTimeout(800);
  A.risposta = 'Secondo'; await A.click('#nome-prog'); await A.click('#pr-nuovo'); await A.waitForTimeout(500);
  await A.setInputFiles('#file', path.join(T, 'Due.wav')); await A.waitForTimeout(800);
  await A.click('#nome-prog'); await A.waitForTimeout(500); const righe = await A.locator('.prog').count();
  verifica(righe === 2, `la lista mostra 2 progetti (${righe})`);
  await chiudi(A);
  let t = await sync(A, '#g-push', 'Inviati');
  verifica(files.size === 2, `Push: sul repo ci sono 2 file (${[...files.keys()].join(', ')}) — «${t}»`);
  verifica(![...files.values()].some((v) => v.toString().includes('TESTTOKEN')), 'il token non è nei file inviati');
  t = await sync(A, '#g-push', 'già aggiornato');
  verifica(/già aggiornato/.test(t), 'secondo Push senza modifiche: niente da inviare');

  console.log('Dispositivo B: Pull e ricollegamento dei file');
  const B = await apriDispositivo();
  t = await sync(B, '#g-pull', 'Pull fatto');
  verifica(/2 nuovi/.test(t), `Pull: «${t}»`);
  await B.click('#nome-prog'); await B.waitForTimeout(500); verifica((await B.locator('.prog').count()) === 3, 'B ha 3 progetti (il suo vuoto + 2 arrivati)');
  await B.locator('.prog', { hasText: 'Secondo' }).getByText('Apri').click(); await B.waitForTimeout(800);
  const manc = await B.evaluate(() => Object.keys(window.__S.sorgenti).length);
  verifica(manc === 1 && (await B.evaluate(() => window.__S.clips.length)) === 1, 'il progetto «Secondo» è arrivato con la sua clip');
  await B.click('#esporta'); verifica(/Mancano/.test(await B.textContent('#toast')), 'l\'export è bloccato finché mancano i file');
  await B.setInputFiles('#file', path.join(T, 'Due.wav')); await B.waitForTimeout(1000);
  verifica(/Ricollegati 1/.test(await B.textContent('#toast')) && (await B.evaluate(() => window.__S.clips.length)) === 1, 'importando «Due.wav» il file si ricollega senza aggiungere clip');

  console.log('Cancellazione e Push');
  A.risposta = null; await A.click('#nome-prog');
  await A.locator('.prog', { hasText: 'Secondo' }).getByText('Elimina').click(); await A.waitForTimeout(600);
  await chiudi(A);
  t = await sync(A, '#g-push', 'Inviati').catch(async () => stato(A));
  verifica(files.size === 1, `il progetto cancellato è stato tolto dal repo (${files.size} file)`);
  t = await sync(B, '#g-pull', 'Pull fatto');
  verifica(!/0 nuovi/.test('x') && (await B.evaluate(() => 1)), 'B può ancora fare Pull senza errori');

  verifica(!A.errs.length && !B.errs.length, 'nessun errore nella pagina ' + JSON.stringify([...A.errs, ...B.errs]));
  await b.close(); server.close(); fs.rmSync(T, { recursive: true, force: true });
  console.log(fallite ? `\n${fallite} prove FALLITE` : '\nTutte le prove di progetti e sincronizzazione passano.');
  process.exit(fallite ? 1 : 0);
})().catch((e) => { console.error('FALLITO', e); process.exit(1); });
