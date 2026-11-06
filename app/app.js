// app.js - interfaccia dell'editor: timeline su canvas, gesti, riproduzione, esportazione.
import { BUILD } from './build.js';
import * as M from './modello.js';
import { contesto, decodificaFile, ricampiona, calcolaPicchi, programma, renderizzaDiretto, codificaWav } from './audio.js';
import { metaLeggi, metaSalva, metaElimina, progettiTutti, progettoLeggi, progettoSalva, progettoElimina, audioSalva, audioLeggi, audioElimina, audioChiavi, tuttoSvuota } from './idb.js';
import { leggiConfig, salvaConfig, controllaConfig, spiegaErrore, provaToken, leggiRemoti, pushProgetti } from './github.js';
import { zipStore } from './zip.js';

const $ = (s) => document.querySelector(s);

/* ---------- stato ---------- */
const S = { id: null, aggiornato: 0, clips: [], marcatori: [], sorgenti: {}, nome: 'Montaggio', magnete: true, pps: 60, t: 0, sel: null, rate: 0 };
if (location.search.includes('debug')) window.__S = S; // solo per le prove automatiche
const buffers = new Map();   // id sorgente → AudioBuffer
const picchi = new Map();    // id sorgente → picchi per la forma d'onda
const storia = M.nuovaStoria();
let riprod = null;           // { t0, tc, nodi } mentre suona

/* ---------- icone ---------- */
const ICONE = {
  taglia: '<path d="M12 3v18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  elimina: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  cross: '<path d="M3 6c8 0 10 12 18 12M3 18c8 0 10-12 18-12"/>',
  marc: '<path d="M6 21V4M6 5h12l-3 4 3 4H6"/>',
  pause: '<path d="M3 10v4M7 7v10M12 12h0M17 7v10M21 10v4"/>',
  play: '<path class="pieno" d="M7 4l13 8-13 8z"/>',
  stop: '<rect class="pieno" x="6" y="5" width="4" height="14" rx="1"/><rect class="pieno" x="14" y="5" width="4" height="14" rx="1"/>',
  inizio: '<path d="M6 5v14M19 5 9 12l10 7z"/>',
  fine: '<path d="M18 5v14M5 5l10 7-10 7z"/>',
  annulla: '<path d="M8 6 3 11l5 5M3 11h11a4 4 0 0 1 0 8H8"/>',
  ripristina: '<path d="m16 6 5 5-5 5M21 11H10a4 4 0 0 0 0 8h6"/>',
  magnete: '<path d="M5 3v8a7 7 0 0 0 14 0V3h-4v8a3 3 0 0 1-6 0V3zM5 7h4M15 7h4"/>',
};
const icona = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONE[n]}</svg>`;
const ETICHETTE = { taglia: 'Taglia', elimina: 'Elimina', cross: 'Crossfade', marc: 'Marcatore', pause: 'Pause' };
for (const [id, n] of [['taglia', 'taglia'], ['elimina', 'elimina'], ['cross', 'cross'], ['marc', 'marc'], ['pause', 'pause']]) {
  $('#b-' + id).innerHTML = icona(n) + `<span>${ETICHETTE[n]}</span>`;
}
$('#b-inizio').innerHTML = icona('inizio');
$('#b-fine').innerHTML = icona('fine');
$('#b-annulla').innerHTML = icona('annulla');
$('#b-ripristina').innerHTML = icona('ripristina');
$('#magnete').innerHTML = icona('magnete');

/* ---------- utilità ---------- */
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const pad = (n, k = 2) => String(Math.floor(n)).padStart(k, '0');
function tempo(t, dec = 2) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${pad(m)}:${s.toFixed(dec).padStart(dec ? dec + 3 : 2, '0')}`;
}
let toastTimer;
function toast(msg, ms = 2800) {
  const e = $('#toast'); e.textContent = msg; e.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove('on'), ms);
}
function attesa(testo) { $('#attesa').hidden = !testo; if (testo) $('#attesa-testo').textContent = testo; }
const respira = () => new Promise((r) => setTimeout(r, 30));
const totale = () => M.durataTotale(S.clips);
const clipSel = () => (S.sel ? M.trova(S.clips, S.sel) : null);

/* ---------- salvataggio sul telefono ---------- */
const nuovoIdProg = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
let guardaT, ultimoSnap = '';
const snapshot = () => JSON.stringify([S.clips, S.marcatori, S.nome]);
const registro = () => ({
  v: 1, id: S.id, nome: S.nome, aggiornato: S.aggiornato, rate: S.rate, clips: S.clips, marcatori: S.marcatori,
  sorgenti: S.sorgenti, magnete: S.magnete, pps: S.pps, t: S.t,
});
function guardia() { clearTimeout(guardaT); guardaT = setTimeout(salvaOra, 500); }
/** Salva subito il progetto aperto. «aggiornato» cambia solo se sono cambiati clip, marcatori o nome (non per un semplice scorrimento). */
async function salvaOra() {
  clearTimeout(guardaT);
  if (!S.id) return;
  const snap = snapshot();
  if (snap !== ultimoSnap) { ultimoSnap = snap; S.aggiornato = Date.now(); }
  await progettoSalva(registro());
}
addEventListener('visibilitychange', () => { if (document.hidden) salvaOra(); });
addEventListener('pagehide', () => { salvaOra(); });

/** Esegue una modifica: ferma la riproduzione, salva lo stato per «annulla», poi aggiorna tutto. */
function modifica(fn) {
  ferma();
  storia.salva(S);
  const r = fn();
  if (r === false) { storia.scartaSeUguale(S); return false; }
  fineModifica();
  return true;
}
function fineModifica() {
  if (S.sel && !clipSel()) S.sel = null;
  S.t = clamp(S.t, 0, Math.max(totale(), 0));
  aggiorna(); guardia();
}

/* ---------- colori e canvas ---------- */
const css = getComputedStyle(document.documentElement);
const C = {};
const leggiColori = () => { for (const n of ['viola', 'arancione', 'giallo', 'lilla', 'bianco', 'ui-sfondo', 'ui-pannello', 'ui-linea', 'ui-testo', 'ui-tenue']) C[n] = css.getPropertyValue('--' + n).trim(); };
leggiColori();

const cv = $('#tl'), g = cv.getContext('2d');
let W = 300, H = 200;
const RUL = 30, TOP = 46;
const alt = () => Math.max(70, Math.min(230, H - TOP - 16));
const xDi = (t) => W / 2 + (t - S.t) * S.pps;

function ridimensiona() {
  const r = $('#area').getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  W = Math.max(100, r.width); H = Math.max(100, r.height);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  disegna();
}
new ResizeObserver(ridimensiona).observe($('#area'));

const PASSI = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

function disegnaRighello() {
  g.fillStyle = C['ui-pannello']; g.fillRect(0, 0, W, RUL);
  g.strokeStyle = C['ui-linea']; g.lineWidth = 1; g.beginPath(); g.moveTo(0, RUL + .5); g.lineTo(W, RUL + .5); g.stroke();
  const passo = PASSI.find((p) => p * S.pps >= 78) || 3600, sub = passo / 5;
  const t0 = S.t - W / 2 / S.pps, t1 = S.t + W / 2 / S.pps;
  const dec = passo < 0.1 ? 2 : passo < 1 ? 1 : 0;
  g.font = '12px ' + getComputedStyle(document.body).fontFamily; g.textBaseline = 'top';
  for (let k = Math.ceil(t0 / sub); k * sub <= t1; k++) {
    const t = k * sub; if (t < -1e-9) continue;
    const x = Math.round(xDi(t)) + .5, magg = Math.abs(t / passo - Math.round(t / passo)) < 1e-6;
    g.strokeStyle = magg ? C['ui-tenue'] : C['ui-linea'];
    g.beginPath(); g.moveTo(x, RUL); g.lineTo(x, RUL - (magg ? 12 : 6)); g.stroke();
    if (magg) { g.fillStyle = C['ui-tenue']; g.fillText(tempo(t, dec).replace(/^00:/, ''), x + 4, 4); }
  }
  // marcatori
  S.marcatori.forEach((m, i) => {
    const x = xDi(m); if (x < -20 || x > W + 20) return;
    g.fillStyle = C.giallo; g.beginPath(); g.moveTo(x - 7, RUL - 14); g.lineTo(x + 7, RUL - 14); g.lineTo(x, RUL); g.closePath(); g.fill();
    g.strokeStyle = C.giallo; g.lineWidth = 1; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(x + .5, RUL); g.lineTo(x + .5, H); g.stroke(); g.setLineDash([]);
    g.fillStyle = C.giallo; g.fillText(String(i + 1), x + 9, 2);
  });
}

function percorsoClip(x0, y0, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x0 + r, y0); g.arcTo(x0 + w, y0, x0 + w, y0 + h, r); g.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
  g.arcTo(x0, y0 + h, x0, y0, r); g.arcTo(x0, y0, x0 + w, y0, r); g.closePath();
}

function disegnaClip(c, sel, vis) {
  const x0 = xDi(c.start), x1 = xDi(M.fine(c)), h = alt(), y0 = TOP, w = x1 - x0;
  if (x1 < -2 || x0 > W + 2) return;
  g.save();
  const manca = !buffers.has(c.src);
  percorsoClip(x0, y0, w, h, 10); g.fillStyle = manca ? C['ui-linea'] : C.arancione; g.fill();
  g.clip();
  // forma d'onda
  const pk = picchi.get(c.src);
  if (pk) {
    g.fillStyle = C.viola;
    const mid = y0 + h / 2, amp = h / 2 * 0.9, n = pk.max.length;
    for (let px = Math.max(0, Math.floor(x0)); px < Math.min(W, Math.ceil(x1)); px++) {
      const ta = c.off + (px - x0) / S.pps, tb = ta + 1 / S.pps;
      const ba = clamp(Math.floor(ta / pk.passo), 0, n - 1), bb = clamp(Math.floor(tb / pk.passo), ba, n - 1);
      const salto = Math.max(1, Math.ceil((bb - ba) / 40));
      let lo = 0, hi = 0;
      for (let b = ba; b <= bb; b += salto) { if (pk.min[b] < lo) lo = pk.min[b]; if (pk.max[b] > hi) hi = pk.max[b]; }
      g.fillRect(px, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
    }
  }
  // dissolvenze
  const curva = (k) => Math.sin(k * Math.PI / 2);
  g.fillStyle = 'rgba(46,25,118,.5)'; g.strokeStyle = C.bianco; g.lineWidth = 1.5;
  if (c.fadeIn > 0) {
    const fw = c.fadeIn * S.pps;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0, y0 + h);
    for (let k = 0; k <= 16; k++) g.lineTo(x0 + fw * k / 16, y0 + h * (1 - curva(k / 16)));
    g.closePath(); g.fill();
    g.beginPath(); for (let k = 0; k <= 16; k++) g[k ? 'lineTo' : 'moveTo'](x0 + fw * k / 16, y0 + h * (1 - curva(k / 16))); g.stroke();
  }
  if (c.fadeOut > 0) {
    const fw = c.fadeOut * S.pps;
    g.beginPath();
    for (let k = 16; k >= 0; k--) g[k === 16 ? 'moveTo' : 'lineTo'](x1 - fw * k / 16, y0 + h * (1 - curva(k / 16)));
    g.lineTo(x1, y0); g.closePath(); g.fill();
    g.beginPath(); for (let k = 0; k <= 16; k++) g[k ? 'lineTo' : 'moveTo'](x1 - fw * k / 16, y0 + h * (1 - curva(k / 16))); g.stroke();
  }
  // nome
  g.fillStyle = manca ? C['ui-testo'] : C.viola; g.font = '15px Staatliches, sans-serif'; g.textBaseline = 'top';
  if (w > 40) g.fillText(c.nome, Math.min(Math.max(x0 + 10, 8), x1 - 30), y0 + 8, Math.max(20, x1 - Math.max(x0 + 10, 8) - 10));
  if (manca && w > 60) {
    const a = Math.max(x0, 0), z = Math.min(x1, W);
    g.fillStyle = C['ui-tenue']; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('file mancante: importalo di nuovo', (a + z) / 2, y0 + h / 2, Math.max(40, z - a - 16));
    g.textAlign = 'left';
  }
  g.restore();
  // bordo e maniglie
  percorsoClip(x0, y0, w, h, 10); g.lineWidth = sel ? 3 : 1.5; g.strokeStyle = sel ? C.bianco : C.giallo; g.stroke();
  if (sel) {
    g.fillStyle = C.bianco;
    for (const x of [x0, x1]) { percorsoClip(x - 5, y0 + h / 2 - 22, 10, 44, 5); g.fill(); }
    const v = vis.get(c.id);
    for (const x of [x0 + v.fi * S.pps, x1 - v.fo * S.pps]) {
      g.beginPath(); g.arc(x, y0, 10, 0, Math.PI * 2); g.fillStyle = C.bianco; g.fill();
      g.beginPath(); g.arc(x, y0, 4, 0, Math.PI * 2); g.fillStyle = C.viola; g.fill();
    }
  }
}

/** Dove due clip si sovrappongono disegna la X del crossfade (una sfuma via, l'altra entra). */
function disegnaCrossfade() {
  const h = alt();
  for (const { L, R } of M.sovrapposizioni(S.clips)) {
    const xs = xDi(R.start), xe = xDi(M.fine(L));
    if (xe < 0 || xs > W || xe - xs < 3) continue;
    g.save();
    g.beginPath(); g.rect(xs, TOP, xe - xs, h); g.clip();
    g.fillStyle = 'rgba(46,25,118,.42)'; g.fillRect(xs, TOP, xe - xs, h);
    g.strokeStyle = C.bianco; g.lineWidth = 2;
    for (const gain of [(k) => Math.cos(k * Math.PI / 2), (k) => Math.sin(k * Math.PI / 2)]) {
      g.beginPath();
      for (let k = 0; k <= 20; k++) g[k ? 'lineTo' : 'moveTo'](xs + (xe - xs) * k / 20, TOP + h * (1 - gain(k / 20)));
      g.stroke();
    }
    g.restore();
  }
}

function disegna() {
  g.clearRect(0, 0, W, H);
  g.fillStyle = C['ui-sfondo']; g.fillRect(0, 0, W, H);
  // zona prima dello zero
  const x00 = xDi(0);
  if (x00 > 0) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, RUL + 1, Math.min(W, x00), H); }
  disegnaRighello();
  // corsia della traccia
  g.fillStyle = C['ui-pannello']; g.fillRect(Math.max(0, x00), TOP - 6, W, alt() + 12);
  const ord = [...S.clips].sort((a, b) => a.start - b.start);
  const vis = M.fadeVisibili(S.clips);
  for (const c of ord) if (c.id !== S.sel) disegnaClip(c, false, vis);
  const s = clipSel(); if (s) disegnaClip(s, true, vis);
  disegnaCrossfade();
  // playhead fisso al centro
  g.strokeStyle = C.bianco; g.fillStyle = C.bianco; g.lineWidth = 2;
  g.beginPath(); g.moveTo(W / 2, RUL); g.lineTo(W / 2, H - 6); g.stroke();
  g.beginPath(); g.arc(W / 2, RUL + 4, 5, 0, 7); g.fill(); g.beginPath(); g.arc(W / 2, H - 6, 5, 0, 7); g.fill();
}

/* ---------- interfaccia ---------- */
function aggiorna() {
  $('#nome-prog-t').textContent = S.nome;
  $('#t-corrente').textContent = tempo(S.t);
  $('#t-totale').textContent = '/ ' + tempo(totale(), 0);
  $('#vuoto').hidden = S.clips.length > 0;
  $('#b-taglia').disabled = !M.clipA(S.clips, S.t);
  $('#b-elimina').disabled = !clipSel();
  $('#b-cross').disabled = !clipSel();
  $('#b-pause').disabled = !S.clips.length;
  $('#b-annulla').disabled = !storia.puoAnnullare();
  $('#b-ripristina').disabled = !storia.puoRipristinare();
  $('#esporta').disabled = !S.clips.length;
  $('#b-play').innerHTML = icona(riprod ? 'stop' : 'play');
  $('#b-play').setAttribute('aria-label', riprod ? 'Pausa' : 'Riproduci');
  $('#magnete').classList.toggle('on', S.magnete);
  $('#magnete').setAttribute('aria-pressed', S.magnete);
  const ch = $('#chips');
  if (ch.dataset.k !== JSON.stringify(S.marcatori)) {
    ch.dataset.k = JSON.stringify(S.marcatori);
    ch.innerHTML = S.marcatori.length ? '' : '<span class="vuoto">Nessun marcatore: tocca «Marcatore» per segnare un punto.</span>';
    S.marcatori.forEach((m, i) => {
      const e = document.createElement('div'); e.className = 'chip';
      e.innerHTML = `<button type="button" data-v="${i}">⚑ ${i + 1} · ${tempo(m, 1)}</button><button type="button" data-x="${i}" aria-label="Togli marcatore">✕</button>`;
      ch.appendChild(e);
    });
  }
  disegna();
}
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.v != null) { ferma(); S.t = S.marcatori[+b.dataset.v]; aggiorna(); guardia(); }
  if (b.dataset.x != null) modifica(() => { S.marcatori.splice(+b.dataset.x, 1); });
});

/* ---------- gesti sulla timeline ---------- */
const ptrs = new Map();
let gesto = null, pinch = null;
const durSorgente = (c) => buffers.get(c.src)?.duration ?? c.off + c.dur;

function bersaglio(x, y) {
  const c = clipSel(), h = alt();
  if (c) {
    const x0 = xDi(c.start), x1 = xDi(M.fine(c));
    const vf = M.fadeVisibili(S.clips).get(c.id);
    const fadeI = x0 + vf.fi * S.pps, fadeO = x1 - vf.fo * S.pps;
    if (y >= TOP - 14 && y <= TOP + 34) {
      const di = Math.abs(x - fadeI), dof = Math.abs(x - fadeO);
      if (Math.min(di, dof) <= 26) return { tipo: di <= dof ? 'fadeIn' : 'fadeOut', c };
    }
    if (y >= TOP && y <= TOP + h) {
      const dl = Math.abs(x - x0), dr = Math.abs(x - x1);
      if (Math.min(dl, dr) <= 24) return { tipo: dl <= dr ? 'trimSx' : 'trimDx', c };
    }
  }
  if (y >= TOP && y <= TOP + h) {
    const t = S.t + (x - W / 2) / S.pps, c2 = M.clipA(S.clips, t);
    if (c2) return { tipo: c2.id === S.sel ? 'sposta' : 'clip', c: c2 };
  }
  return { tipo: 'pan', c: null };
}

cv.addEventListener('pointerdown', (e) => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x, y });
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), pps0: S.pps };
    if (gesto?.u) { storia.scartaSeUguale(S); }
    gesto = null; return;
  }
  const b = bersaglio(x, y);
  if (riprod && b.tipo !== 'pan' && b.tipo !== 'clip') ferma();
  gesto = { tipo: b.tipo, id: b.c?.id, x0: x, y0: y, t0: S.t, orig: M.copia(S.clips), mosso: false, ts: performance.now(), u: false, vis: M.fadeVisibili(S.clips) };
});

cv.addEventListener('pointermove', (e) => {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x, y });
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    S.pps = clamp(pinch.pps0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0, 4, 1500);
    aggiorna(); return;
  }
  if (!gesto) return;
  const dx = x - gesto.x0;
  if (!gesto.mosso && Math.hypot(dx, y - gesto.y0) > 6) gesto.mosso = true;
  if (!gesto.mosso) return;
  const dt = dx / S.pps, o = gesto.id ? M.trova(gesto.orig, gesto.id) : null;
  const muta = () => { if (!gesto.u) { ferma(); storia.salva({ clips: gesto.orig, marcatori: S.marcatori }); gesto.u = true; } };
  const th = 12 / S.pps;
  switch (gesto.tipo) {
    case 'pan': case 'clip':
      if (riprod) ferma();
      S.t = clamp(gesto.t0 - dt, 0, totale());
      break;
    case 'sposta': {
      muta();
      let ns = o.start + dt;
      if (S.magnete) {
        const p = M.puntiAggancio(gesto.orig, o.id, S.t);
        const a = M.aggancia(ns, p, th), b = M.aggancia(ns + o.dur, p, th) - o.dur;
        ns = Math.abs(a - ns) <= Math.abs(b - ns) ? a : b;
      }
      S.clips = M.gestoSposta(gesto.orig, o.id, ns);
      break;
    }
    case 'trimSx': case 'trimDx': {
      muta();
      const sx = gesto.tipo === 'trimSx';
      let d = dt;
      if (S.magnete) { // il bordo si aggancia al playhead e ai bordi delle altre clip
        const p = M.puntiAggancio(gesto.orig, o.id, S.t), bordo = sx ? o.start : M.fine(o);
        d = M.aggancia(bordo + d, p, th) - bordo;
      }
      S.clips = M.gestoTrim(gesto.orig, o.id, sx ? 'sx' : 'dx', d, S.magnete, durSorgente(o));
      break;
    }
    case 'fadeIn': muta(); S.clips = M.gestoFade(gesto.orig, o.id, 'in', gesto.vis.get(o.id).fi + dt); break;
    case 'fadeOut': muta(); S.clips = M.gestoFade(gesto.orig, o.id, 'out', gesto.vis.get(o.id).fo - dt); break;
  }
  aggiorna();
});

function fineGesto(e) {
  ptrs.delete(e.pointerId);
  if (pinch) { if (ptrs.size < 2) { pinch = null; guardia(); } return; }
  const gs = gesto; gesto = null;
  if (!gs) return;
  if (!gs.mosso && performance.now() - gs.ts < 500 && e.type === 'pointerup') { // tocco semplice
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (y < RUL + 4) {
      const i = S.marcatori.findIndex((m) => Math.abs(xDi(m) - x) < 20);
      if (i >= 0) { ferma(); S.t = S.marcatori[i]; }
    } else if (gs.tipo === 'clip') S.sel = gs.id;
    else if (gs.tipo === 'pan') S.sel = null;
  }
  if (gs.u) storia.scartaSeUguale(S);
  fineModifica();
}
cv.addEventListener('pointerup', fineGesto);
cv.addEventListener('pointercancel', fineGesto);
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) S.pps = clamp(S.pps * Math.exp(-e.deltaY * 0.01), 4, 1500);
  else { ferma(); S.t = clamp(S.t + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / S.pps, 0, totale()); }
  aggiorna(); guardia();
}, { passive: false });

/* ---------- riproduzione ---------- */
function suona() {
  if (!S.clips.length) return;
  const c = contesto();
  if (S.t >= totale() - 0.02) S.t = 0;
  const tc = c.currentTime + 0.06;
  riprod = { t0: S.t, tc, nodi: programma(c, S.clips, buffers, S.t, tc) };
  cicloRiprod();
}
function cicloRiprod() {
  if (!riprod) return;
  S.t = riprod.t0 + Math.max(0, contesto().currentTime - riprod.tc);
  if (S.t >= totale()) { S.t = totale(); ferma(); return; }
  aggiorna();
  requestAnimationFrame(cicloRiprod);
}
function ferma() {
  if (!riprod) return;
  for (const n of riprod.nodi) { try { n.stop(); n.disconnect(); } catch { /* già fermo */ } }
  riprod = null; aggiorna(); guardia();
}
$('#b-play').onclick = () => (riprod ? ferma() : suona());
$('#b-inizio').onclick = () => { ferma(); S.t = 0; aggiorna(); guardia(); };
$('#b-fine').onclick = () => { ferma(); S.t = totale(); aggiorna(); guardia(); };

/* ---------- barra degli strumenti ---------- */
$('#b-taglia').onclick = () => {
  const ok = modifica(() => {
    const id = M.taglia(S, S.t);
    if (!id) return false;
    S.sel = id;
  });
  if (!ok) toast('Qui non c’è niente da tagliare (porta il cursore dentro una clip).');
};
$('#b-elimina').onclick = () => {
  if (!clipSel()) return;
  modifica(() => { M.elimina(S, S.sel, S.magnete); S.sel = null; });
};
$('#b-marc').onclick = () => modifica(() => { const r = M.marcatore(S, S.t); toast(r === 'aggiunto' ? 'Marcatore aggiunto' : 'Marcatore tolto', 1200); });
$('#b-annulla').onclick = () => { ferma(); if (storia.annulla(S)) fineModifica(); };
$('#b-ripristina').onclick = () => { ferma(); if (storia.ripristina(S)) fineModifica(); };
$('#magnete').onclick = () => { S.magnete = !S.magnete; toast(S.magnete ? 'Magnete acceso: le clip restano attaccate a sinistra.' : 'Magnete spento: le clip restano dove sono.', 2200); aggiorna(); guardia(); };

const zoom = (k) => { S.pps = clamp(S.pps * k, 4, 1500); aggiorna(); guardia(); };
$('#zoom-piu').onclick = () => zoom(1.5);
$('#zoom-meno').onclick = () => zoom(1 / 1.5);

// passi fini del cursore (tenendo premuto si ripete)
function passoFine(dir) { ferma(); S.t = clamp(S.t + dir * Math.max(0.001, 8 / S.pps), 0, totale()); aggiorna(); }
function ripeti(el, dir) {
  let t1, t2;
  const stop = () => { clearTimeout(t1); clearInterval(t2); guardia(); };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); passoFine(dir); t1 = setTimeout(() => { t2 = setInterval(() => passoFine(dir), 60); }, 350); });
  for (const n of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(n, stop);
}
ripeti($('#piu-meno'), -1); ripeti($('#piu-piu'), 1);

/* ---------- finestre ---------- */
const apri = (d) => { ferma(); d.returnValue = ''; if (!d.open) d.showModal(); };
const doc = (id) => $(id);

// Crossfade
const dCross = doc('#d-cross');
const rotula = (inp, lab, f) => { const u = () => { $(lab).textContent = f(+$(inp).value); }; $(inp).addEventListener('input', u); u(); };
rotula('#x-ms', '#x-ms-v', (v) => v + ' ms');
$('#b-cross').onclick = () => apri(dCross);
dCross.addEventListener('close', () => {
  if (dCross.returnValue !== 'ok') return;
  let esito;
  modifica(() => { esito = M.crossfade(S, S.sel, +$('#x-ms').value / 1000, S.magnete); return esito.ok; });
  toast(esito.ok ? `Crossfade di ${Math.round(esito.sec * 1000)} ms creato` : esito.motivo);
});

// Pause
const dPause = doc('#d-pause');
rotula('#p-soglia', '#p-soglia-v', (v) => v + ' dB');
rotula('#p-min', '#p-min-v', (v) => v.toFixed(1).replace('.', ',') + ' s');
rotula('#p-man', '#p-man-v', (v) => v.toFixed(2).replace('.', ',') + ' s');
$('#b-pause').onclick = () => apri(dPause);
dPause.addEventListener('close', () => {
  if (dPause.returnValue !== 'ok') return;
  let r;
  modifica(() => {
    r = M.accorciaPause(S, (id) => { const p = picchi.get(id); return p ? { passo: p.passo, max: p.ass } : null; },
      { sogliaDb: +$('#p-soglia').value, minDur: +$('#p-min').value, mantieni: +$('#p-man').value });
    return r.pause > 0;
  });
  toast(r.pause ? `${r.pause} pause accorciate: tolti ${r.rimosso.toFixed(1).replace('.', ',')} s` : 'Nessuna pausa abbastanza lunga: prova ad alzare la soglia.');
});

/* ---------- progetti ---------- */
const dProg = doc('#d-progetti');
const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const CHIAVE_CANC = 'aeah-canc-v1'; // progetti cancellati qui: al prossimo Push vanno tolti anche dal repo (e il Pull non li riporta)
const cancellati = () => { try { return JSON.parse(localStorage.getItem(CHIAVE_CANC)) || []; } catch { return []; } };
const memorizzaCancellati = (ids) => { try { localStorage.setItem(CHIAVE_CANC, JSON.stringify([...new Set(ids)])); } catch { /* niente */ } };
const mb = (b) => (b ? (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',') + ' MB' : '0 MB');
const quando = (ms) => (ms ? new Date(ms).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const byteDi = (rec) => Object.values(rec.sorgenti || {}).reduce((t, x) => t + (x.bytes || 0), 0);

async function renderProgetti() {
  await salvaOra();
  const tutti = (await progettiTutti()).sort((a, b) => (b.aggiornato || 0) - (a.aggiornato || 0));
  $('#lista-progetti').innerHTML = tutti.map((r) => `<div class="prog${r.id === S.id ? ' aperto' : ''}">
    <b>${esc(r.nome)}${r.id === S.id ? '<span class="tag">aperto</span>' : ''}</b>
    <small>${tempo(M.durataTotale(r.clips || []), 0)} · ${(r.clips || []).length} clip · ${mb(byteDi(r))} di audio · modificato ${quando(r.aggiornato)}</small>
    <div class="az">${r.id === S.id ? '' : `<button class="btn" type="button" data-az="apri" data-id="${esc(r.id)}">Apri</button>`}
      <button class="btn" type="button" data-az="rinomina" data-id="${esc(r.id)}">Rinomina</button>
      <button class="btn" type="button" data-az="duplica" data-id="${esc(r.id)}">Duplica</button>
      <button class="btn pericolo" type="button" data-az="elimina" data-id="${esc(r.id)}">Elimina</button></div></div>`).join('') || '<p class="nota">Nessun progetto.</p>';
  const unici = new Map(); for (const r of tutti) for (const [k, x] of Object.entries(r.sorgenti || {})) unici.set(k, x.bytes || 0);
  $('#pr-spazio').textContent = `File audio salvati su questo telefono: ${mb([...unici.values()].reduce((a, b) => a + b, 0))} (i file originali restano dove sono: qui ne tengo una copia per riaprire i progetti).`;
}
$('#nome-prog').onclick = async () => { ferma(); await renderProgetti(); apri(dProg); };
$('#lista-progetti').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-az]'); if (!b) return;
  const id = b.dataset.id, az = b.dataset.az;
  if (az === 'apri') { await salvaOra(); const rec = await progettoLeggi(id); dProg.close(); if (rec) await apriRegistro(rec); }
  else if (az === 'duplica') {
    await salvaOra(); const rec = await progettoLeggi(id);
    if (rec) await progettoSalva({ ...rec, id: nuovoIdProg(), nome: `${rec.nome} (copia)`.slice(0, 60), aggiornato: Date.now() });
    await renderProgetti();
  } else if (az === 'rinomina') {
    const rec = await progettoLeggi(id); if (!rec) return;
    const n = prompt('Nome del progetto:', rec.nome);
    if (n && n.trim()) {
      if (id === S.id) { S.nome = n.trim().slice(0, 60); await salvaOra(); aggiorna(); }
      else { rec.nome = n.trim().slice(0, 60); rec.aggiornato = Date.now(); await progettoSalva(rec); }
      await renderProgetti();
    }
  } else if (az === 'elimina') {
    const rec = await progettoLeggi(id); if (!rec) return;
    if (!confirm(`Eliminare «${rec.nome}»? I file audio usati solo da questo progetto verranno tolti dal telefono.`)) return;
    await eliminaProgetto(id); await renderProgetti();
  }
});
$('#pr-nuovo').onclick = async () => {
  const n = prompt('Nome del nuovo progetto:', `Montaggio ${(await progettiTutti()).length + 1}`);
  if (n === null) return;
  dProg.close(); await creaProgetto(n.trim().slice(0, 60) || 'Montaggio');
};

async function eliminaProgetto(id) {
  await progettoElimina(id); memorizzaCancellati([...cancellati(), id]);
  if (id === S.id) {
    S.id = null;
    const resto = (await progettiTutti()).sort((a, b) => (b.aggiornato || 0) - (a.aggiornato || 0))[0];
    if (resto) await apriRegistro(resto); else await creaProgetto('Montaggio');
  }
  await liberaFile();
}

/** Toglie dal telefono i file audio che nessun progetto usa più. Ritorna quanti ne ha tolti. */
async function liberaFile() {
  await salvaOra();
  const usati = new Set();
  for (const r of await progettiTutti()) for (const k of Object.keys(r.sorgenti || {})) usati.add(k);
  let n = 0;
  for (const k of await audioChiavi()) if (!usati.has(k)) { await audioElimina(k); buffers.delete(k); picchi.delete(k); n++; }
  return n;
}

/* ---------- impostazioni e sincronizzazione ---------- */
const dImpo = doc('#d-impo');
const statoG = (t) => { $('#g-stato').textContent = t; };
$('#menu').onclick = () => {
  const c = leggiConfig();
  $('#g-token').value = ''; $('#g-token').placeholder = c.token ? '•••••••• salvato (scrivi per cambiarlo)' : 'incolla qui il token';
  $('#g-repo').value = c.repo; $('#g-cartella').value = c.cartella; statoG('');
  $('#m-info').textContent = `Audio Editor ad hoc · build ${BUILD}`;
  apri(dImpo);
};
const leggiCampi = () => {
  const c = leggiConfig(), t = $('#g-token').value.trim();
  return { ...c, token: t || c.token, repo: $('#g-repo').value.trim(), cartella: $('#g-cartella').value.trim().replace(/^\/+|\/+$/g, '') };
};
const campiOk = () => { const c = leggiCampi(), err = controllaConfig(c); if (err) { statoG(err); return null; } salvaConfig(c); $('#g-token').value = ''; return c; };

$('#g-salva').onclick = async () => {
  const c = campiOk(); if (!c) return;
  statoG('Controllo il token…');
  try {
    const r = await provaToken(c);
    statoG(r.puoScrivere ? `Tutto a posto: posso leggere e scrivere su ${r.nome}.` : `Il token legge ${r.nome} ma NON può scrivere: serve il permesso «Contents: Read and write».`);
  } catch (e) { statoG(spiegaErrore(e)); }
};
$('#g-rimuovi').onclick = () => {
  salvaConfig({ ...leggiConfig(), token: '' });
  $('#g-token').value = ''; $('#g-token').placeholder = 'incolla qui il token'; statoG('Token tolto da questo telefono.');
};
$('#g-push').onclick = async () => {
  const c = campiOk(); if (!c) return;
  try {
    await salvaOra();
    const locali = await progettiTutti(), canc = cancellati();
    const r = await pushProgetti(c, locali, canc, statoG);
    memorizzaCancellati([]);
    const parti = [];
    if (r.cambiato) parti.push(`Inviati ${r.inviati.length} progetti${r.tolti ? `, tolti dal repo ${r.tolti}` : ''}.`); else if (!r.saltati.length) parti.push('Niente da inviare: il repo è già aggiornato.');
    if (r.saltati.length) parti.push(`Non inviati perché sul repo sono più recenti: ${r.saltati.join(', ')}. Fai prima Pull.`);
    statoG(parti.join(' '));
  } catch (e) { statoG(spiegaErrore(e)); }
};
$('#g-pull').onclick = async () => {
  const c = campiOk(); if (!c) return;
  try {
    await salvaOra();
    const remoti = await leggiRemoti(c, statoG);
    const locali = new Map((await progettiTutti()).map((r) => [r.id, r])), canc = new Set(cancellati());
    let nuovi = 0, aggiornati = 0, rifiutati = 0, riapri = false; const piuLocali = [];
    for (const { id, rec } of remoti) {
      const v = validaRegistro(rec);
      if (!v || v.id !== id) { rifiutati++; continue; }
      if (canc.has(v.id)) continue;
      const l = locali.get(v.id);
      if (!l) { await progettoSalva(v); nuovi++; }
      else if (v.aggiornato > (l.aggiornato || 0)) { await progettoSalva(v); aggiornati++; if (v.id === S.id) riapri = true; }
      else if (v.aggiornato < (l.aggiornato || 0)) piuLocali.push(l.nome);
    }
    if (riapri) { const rec = await progettoLeggi(S.id); if (rec) await apriRegistro(rec); }
    const parti = [`Pull fatto: ${nuovi} nuovi, ${aggiornati} aggiornati.`];
    if (piuLocali.length) parti.push(`Più recenti qui (non toccati): ${piuLocali.join(', ')}.`);
    if (rifiutati) parti.push(`${rifiutati} file del repo non validi, ignorati.`);
    if (nuovi + aggiornati) parti.push('I file audio non viaggiano: apri il progetto e importa di nuovo i file con lo stesso nome per ricollegarli.');
    statoG(parti.join(' '));
  } catch (e) { statoG(spiegaErrore(e)); }
};
/** Rimette in ordine un progetto arrivato dal repo: tiene solo campi e valori sensati. */
function validaRegistro(r) {
  if (!r || typeof r !== 'object' || !/^p[a-z0-9]{3,40}$/.test(String(r.id))) return null;
  const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);
  const sorgenti = {};
  for (const [k, x] of Object.entries(r.sorgenti || {})) {
    if (/^s[\w-]{3,60}$/.test(k) && x && typeof x === 'object') sorgenti[k] = { nome: String(x.nome || '').slice(0, 120), durata: Math.max(0, num(x.durata)), canali: clamp(Math.round(num(x.canali, 1)), 1, 8), bytes: Math.max(0, num(x.bytes)) };
  }
  const clips = (Array.isArray(r.clips) ? r.clips : []).map((c) => ({
    id: String(c?.id || '').slice(0, 40), src: String(c?.src), nome: String(c?.nome || '').slice(0, 120),
    start: Math.max(0, num(c?.start)), off: Math.max(0, num(c?.off)), dur: num(c?.dur), fadeIn: Math.max(0, num(c?.fadeIn)), fadeOut: Math.max(0, num(c?.fadeOut)),
  })).filter((c) => c.id && sorgenti[c.src] && c.dur >= M.MIN_DUR);
  return {
    v: 1, id: r.id, nome: String(r.nome || 'Montaggio').slice(0, 60), aggiornato: Math.max(0, num(r.aggiornato)), rate: Math.max(0, num(r.rate)),
    clips, marcatori: (Array.isArray(r.marcatori) ? r.marcatori : []).map(Number).filter(Number.isFinite), sorgenti,
    magnete: r.magnete !== false, pps: clamp(num(r.pps, 60), 4, 1500), t: Math.max(0, num(r.t)),
  };
}

$('#m-aggiorna').onclick = () => controllaAggiornamenti(true);
$('#m-libera').onclick = async () => { const n = await liberaFile(); toast(n ? `Tolti ${n} file audio che nessun progetto usava.` : 'Non c’è niente da liberare.'); };
$('#m-cancella').onclick = async () => {
  if (!confirm('Cancellare TUTTI i progetti e i file audio salvati su questo telefono? Non si può annullare.')) return;
  ferma(); await tuttoSvuota();
  buffers.clear(); picchi.clear(); S.id = null;
  dImpo.close(); await creaProgetto('Montaggio'); toast('Tutto cancellato.');
};

/* ---------- importazione ---------- */
$('#importa').onclick = () => $('#file').click();
$('#file').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  if (files.length) await importa(files);
});

/** Apre un file; il progetto ha una sola frequenza (quella del primo file): se un altro file è diverso, lo ricampiona. */
async function caricaBuffer(ab, nome) {
  let buf = await decodificaFile(ab);
  if (!S.rate) S.rate = buf.sampleRate;
  else if (buf.sampleRate !== S.rate) {
    if (nome) toast(`«${nome}» è a ${buf.sampleRate} Hz e il progetto a ${S.rate} Hz: viene ricampionato.`, 6000);
    buf = await ricampiona(buf, S.rate);
  }
  return buf;
}

async function importa(files) {
  ferma();
  let n = 0, ricollegati = 0;
  storia.salva(S);
  for (const f of files) {
    attesa(`Carico ${++n} di ${files.length}: ${f.name}`);
    await respira();
    try {
      const buf = await caricaBuffer(await f.arrayBuffer(), f.name);
      const nome = f.name.replace(/\.[^.]+$/, '');
      // un file con lo stesso nome di uno mancante (progetto ripreso con Pull) lo ricollega, senza aggiungere clip
      const orfano = Object.entries(S.sorgenti).find(([k, x]) => !buffers.has(k) && x.nome === nome);
      if (orfano) {
        const [k, x] = orfano;
        await audioSalva(k, f);
        buffers.set(k, buf); picchi.set(k, calcolaPicchi(buf)); x.bytes = f.size;
        ricollegati++;
        if (Math.abs(buf.duration - x.durata) > 0.01) toast(`Attenzione: «${f.name}» ha una durata diversa dall'originale, i tagli potrebbero non combaciare.`, 7000);
        continue;
      }
      const id = 's' + M.nuovoId();
      await audioSalva(id, f);
      buffers.set(id, buf); picchi.set(id, calcolaPicchi(buf));
      S.sorgenti[id] = { nome, durata: buf.duration, canali: buf.numberOfChannels, bytes: f.size };
      S.clips.push({ id: M.nuovoId(), src: id, nome, start: totale(), off: 0, dur: buf.duration, fadeIn: 0, fadeOut: 0 });
    } catch (err) {
      console.error(err);
      toast(`Non riesco a leggere «${f.name}».`);
    }
  }
  attesa(null);
  storia.scartaSeUguale(S);
  fineModifica();
  if (ricollegati) toast(`Ricollegati ${ricollegati} file audio.`);
}

/* ---------- esportazione ---------- */
const dEsp = doc('#d-esporta');
const canaliOut = () => (Object.values(S.sorgenti).some((s) => s.canali > 1) ? 2 : 1);
function stimaEsporta() {
  const bit = +$('#e-bit').value, rate = S.rate;
  const mb = totale() * rate * canaliOut() * (bit / 8) / 1048576;
  $('#e-stima').textContent = `Durata ${tempo(totale(), 0)} · ${S.rate} Hz come l’originale · circa ${mb.toFixed(0)} MB${mb > 600 ? ' — è molto pesante per un telefono: prova 16 bit o esporta a pezzi.' : '.'}${$('#e-tipo').value === 'zip' ? ' Nello zip trovi anche posizioni.txt con l’inizio di ogni clip.' : ''}`;
}
for (const id of ['#e-bit', '#e-tipo']) $(id).addEventListener('change', stimaEsporta);
$('#esporta').onclick = () => {
  if (mancanti().length) { toast('Mancano dei file audio (progetto ripreso con Pull): importali di nuovo con lo stesso nome.', 6000); return; }
  $('#e-nome').value = S.nome;
  stimaEsporta(); apri(dEsp);
};
const nomeSicuro = (s) => (s || 'audio').replace(/[^\w\- àèéìòù]+/gi, '').trim().replace(/\s+/g, '_') || 'audio';

dEsp.addEventListener('close', async () => {
  if (dEsp.returnValue !== 'ok') return;
  const nome = nomeSicuro($('#e-nome').value);
  const bit = +$('#e-bit').value, rate = S.rate, canali = canaliOut();
  try {
    attesa('Calcolo il montaggio…'); await respira();
    if ($('#e-tipo').value === 'wav') {
      const buf = renderizzaDiretto(S.clips, buffers, { rate, canali });
      attesa('Creo il file WAV…'); await respira();
      await consegna(codificaWav(buf, bit), nome + '.wav');
    } else {
      const ord = [...S.clips].sort((a, b) => a.start - b.start);
      const files = []; let righe = ['Posizione di ogni clip sulla timeline (mm:ss.cc):', ''];
      for (let i = 0; i < ord.length; i++) {
        const c = ord[i];
        attesa(`Clip ${i + 1} di ${ord.length}…`); await respira();
        const buf = renderizzaDiretto(S.clips, buffers, { da: c.start, a: M.fine(c), rate, canali, solo: new Set([c.id]) });
        const nf = `${pad(i + 1)}_${nomeSicuro(c.nome)}.wav`;
        files.push({ name: nf, data: new Uint8Array(await codificaWav(buf, bit).arrayBuffer()) });
        righe.push(`${nf}  →  inizio ${tempo(c.start)}  ·  durata ${tempo(c.dur)}`);
      }
      files.push({ name: 'posizioni.txt', data: new TextEncoder().encode(righe.join('\n') + '\n') });
      await consegna(zipStore(files), nome + '.zip');
    }
  } catch (err) {
    console.error(err);
    toast('Esportazione non riuscita: forse il file è troppo grande per la memoria. Prova 16 bit o meno clip.', 5000);
  } finally { attesa(null); }
});

/** Su telefono apre il menu «Condividi» (Salva su File, Drive…); sul computer scarica il file. */
async function consegna(blob, nomeFile) {
  const file = new File([blob], nomeFile, { type: blob.type });
  const touch = matchMedia('(pointer:coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    attesa(null);
    try { await navigator.share({ files: [file], title: nomeFile }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nomeFile;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  toast(`Salvato «${nomeFile}»`);
}

/* ---------- tastiera (computer) ---------- */
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input,select,textarea,dialog')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); (e.shiftKey ? $('#b-ripristina') : $('#b-annulla')).click(); }
  else if (k === ' ') { e.preventDefault(); $('#b-play').click(); }
  else if (k === 's') $('#b-taglia').click();
  else if (k === 'delete' || k === 'backspace') $('#b-elimina').click();
  else if (k === 'm') $('#b-marc').click();
  else if (k === 'arrowleft') passoFine(-1);
  else if (k === 'arrowright') passoFine(1);
});

/* ---------- aggiornamenti e avvio ---------- */
$('#build').textContent = `build ${BUILD}`;
async function controllaAggiornamenti(manuale) {
  try {
    const r = await fetch('app/build.js?check&t=' + Date.now(), { cache: 'no-store' });
    const m = (await r.text()).match(/BUILD\s*=\s*(\d+)/), n = m ? +m[1] : 0;
    if (n > BUILD) {
      const b = $('#aggiorna'); b.hidden = false;
      b.innerHTML = `Nuova versione disponibile (build ${n}) <button type="button" id="aggiorna-ora">Aggiorna</button>`;
      $('#aggiorna-ora').onclick = async () => {
        try { for (const k of await caches.keys()) await caches.delete(k); for (const x of await navigator.serviceWorker.getRegistrations()) await x.unregister(); } catch { /* niente */ }
        location.reload();
      };
      if (manuale) toast(`Disponibile la build ${n}.`);
    } else if (manuale) toast(`Hai già l'ultima versione (build ${BUILD}).`);
  } catch { if (manuale) toast('Non riesco a controllare: forse sei offline.'); }
}

/* ---------- aprire, creare e ripristinare i progetti ---------- */
const mancanti = () => Object.keys(S.sorgenti).filter((k) => !buffers.has(k) && S.clips.some((c) => c.src === k));

/** Apre un progetto: porta in memoria solo l'audio che gli serve e libera quello degli altri. */
async function apriRegistro(rec) {
  ferma(); storia.svuota();
  Object.assign(S, {
    id: rec.id, nome: rec.nome || 'Montaggio', aggiornato: rec.aggiornato || 0, rate: rec.rate || 0, clips: rec.clips || [],
    marcatori: rec.marcatori || [], sorgenti: rec.sorgenti || {}, magnete: rec.magnete !== false, pps: rec.pps || 60, t: rec.t || 0, sel: null,
  });
  ultimoSnap = snapshot();
  for (const k of [...buffers.keys()]) if (!S.sorgenti[k]) { buffers.delete(k); picchi.delete(k); }
  const daCaricare = Object.keys(S.sorgenti).filter((k) => !buffers.has(k));
  if (daCaricare.length) {
    attesa(`Apro «${S.nome}»…`); await respira();
    for (const k of daCaricare) {
      try {
        const blob = await audioLeggi(k);
        if (!blob) continue;
        if (!S.sorgenti[k].bytes) S.sorgenti[k].bytes = blob.size;
        const buf = await caricaBuffer(await blob.arrayBuffer());
        buffers.set(k, buf); picchi.set(k, calcolaPicchi(buf));
      } catch (e) { console.error(e); }
    }
    attesa(null);
  }
  await metaSalva('attivo', S.id);
  S.t = clamp(S.t, 0, totale());
  aggiorna();
  const m = mancanti();
  if (m.length) toast(`Mancano ${m.length} file audio su questo telefono: importali di nuovo con lo stesso nome e si ricollegano da soli.`, 7000);
}

async function creaProgetto(nome) {
  await salvaOra();
  const rec = { v: 1, id: nuovoIdProg(), nome, aggiornato: Date.now(), rate: 0, clips: [], marcatori: [], sorgenti: {}, magnete: true, pps: 60, t: 0 };
  await progettoSalva(rec);
  await apriRegistro(rec);
}

async function avviaProgetti() {
  // il vecchio formato aveva un solo progetto: lo trasformo nel primo della lista
  const vecchio = await metaLeggi('corrente');
  if (vecchio?.clips) {
    const id = nuovoIdProg();
    await progettoSalva({ ...vecchio, id, nome: vecchio.nome || 'Montaggio', aggiornato: Date.now() });
    await metaSalva('attivo', id); await metaElimina('corrente');
  }
  const attivo = await metaLeggi('attivo');
  let rec = attivo ? await progettoLeggi(attivo) : null;
  if (!rec) rec = (await progettiTutti()).sort((a, b) => (b.aggiornato || 0) - (a.aggiornato || 0))[0];
  if (rec) await apriRegistro(rec); else await creaProgetto('Montaggio');
}

(async function avvia() {
  try { await Promise.all([document.fonts.load('15px Staatliches'), document.fonts.load('15px "Libre Baskerville"')]); } catch { /* niente */ }
  ridimensiona();
  await avviaProgetti();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  controllaAggiornamenti(false);
  document.documentElement.dataset.pronto = '1';
})();
