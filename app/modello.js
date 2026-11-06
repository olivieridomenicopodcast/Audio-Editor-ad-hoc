// modello.js - logica di montaggio pura (nessun audio, nessun DOM): funziona nel browser e in Node.
//
// Lo stato è { clips: [...], marcatori: [secondi...] }. Ogni clip è un riferimento NON distruttivo
// a un file sorgente: l'audio originale non si tocca mai.
//   clip = { id, src, nome, start, off, dur, fadeIn, fadeOut }
//   start = posizione sulla timeline (s) · off = punto di partenza dentro il file (s) · dur = durata (s)
// Il «magnete» (ripple) attacca le clip alla sinistra: se togli un pezzo, quelle dopo scorrono indietro.

export const MIN_DUR = 0.05;       // durata minima di una clip (s)
export const DECLICK = 0.003;      // micro-dissolvenza sui tagli non continui, contro i click (s)
export const EPS = 1e-4;

let contatore = 0;
export const nuovoId = () => 'c' + Date.now().toString(36) + (contatore++).toString(36);

export const fine = (c) => c.start + c.dur;
export const copia = (x) => JSON.parse(JSON.stringify(x));
export const ordina = (clips) => clips.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
export const durataTotale = (clips) => clips.reduce((m, c) => Math.max(m, fine(c)), 0);
export const trova = (clips, id) => clips.find((c) => c.id === id);

/** La clip che si sente al tempo t (se più clip si sovrappongono, quella che inizia più tardi). */
export function clipA(clips, t) {
  let r = null;
  for (const c of clips) if (t >= c.start - EPS && t < fine(c) - EPS && (!r || c.start >= r.start)) r = c;
  return r;
}

/** Limita le dissolvenze: non devono superare la durata e non devono sovrapporsi tra loro. */
export function normalizzaFade(c) {
  const max = Math.max(0, c.dur - 0.002);
  c.fadeIn = Math.min(Math.max(0, c.fadeIn || 0), max);
  c.fadeOut = Math.min(Math.max(0, c.fadeOut || 0), Math.max(0, max - c.fadeIn));
  return c;
}

/** Due clip sono «continue» se sono attaccate sia sulla timeline sia dentro lo stesso file: nessun taglio udibile. */
const continue_ = (a, b) => a.src === b.src && Math.abs(fine(a) - b.start) < EPS && Math.abs(a.off + a.dur - b.off) < EPS;

/**
 * Dissolvenze effettive di ogni clip (quelle scelte + il micro-declick). Ritorna Map id → {fi, fo}.
 * Il micro-declick c'è SOLO su un bordo che hai tagliato tu (dentro il file) e che non è un taglio continuo:
 * l'inizio e la fine naturali di un file restano intatti, così senza modifiche l'audio esce identico.
 * durSorgente(src) = durata del file in secondi (senza, ogni bordo si considera tagliato).
 */
export function fadeEffettivi(clips, durSorgente = () => Infinity) {
  const m = new Map();
  for (const c of clips) {
    const sx = clips.some((x) => x !== c && continue_(x, c));
    const dx = clips.some((x) => x !== c && continue_(c, x));
    const taglioSx = c.off > EPS, taglioDx = c.off + c.dur < durSorgente(c.src) - EPS;
    const fi = Math.max(c.fadeIn || 0, !sx && taglioSx ? DECLICK : 0);
    const fo = Math.max(c.fadeOut || 0, !dx && taglioDx ? DECLICK : 0);
    const tot = fi + fo, lim = Math.max(0, c.dur - 0.001);
    const k = tot > lim && tot > 0 ? lim / tot : 1;
    m.set(c.id, { fi: fi * k, fo: fo * k });
  }
  return m;
}

/** Guadagno (0..1) di una clip al tempo t della timeline. Curva a potenza costante (seno/coseno). */
export function guadagno(c, fi, fo, t) {
  const a = fi > 0 ? Math.min(1, Math.max(0, (t - c.start) / fi)) : 1;
  const b = fo > 0 ? Math.min(1, Math.max(0, (fine(c) - t) / fo)) : 1;
  return Math.sin(a * Math.PI / 2) * Math.sin(b * Math.PI / 2);
}

/* ---------- operazioni (modificano lo stato) ---------- */

/** Taglia la clip sotto il tempo t. Ritorna l'id della parte destra, oppure null se non c'è nulla da tagliare. */
export function taglia(stato, t) {
  const c = clipA(stato.clips, t);
  if (!c || t - c.start < MIN_DUR || fine(c) - t < MIN_DUR) return null;
  const d = { ...c, id: nuovoId(), start: t, off: c.off + (t - c.start), dur: fine(c) - t, fadeIn: 0 };
  c.dur = t - c.start;
  c.fadeOut = 0;
  normalizzaFade(c); normalizzaFade(d);
  stato.clips.push(d);
  ordina(stato.clips);
  return d.id;
}

/** Elimina una clip. Con il magnete (ripple) le clip che stavano dopo scorrono indietro e chiudono il buco. */
export function elimina(stato, id, ripple) {
  const c = trova(stato.clips, id);
  if (!c) return false;
  const f = fine(c);
  stato.clips = stato.clips.filter((x) => x !== c);
  if (ripple) for (const x of stato.clips) if (x.start >= f - EPS) x.start -= c.dur;
  return true;
}

/** Crossfade con la clip a sinistra: la clip si sposta indietro di `sec` e le due si sovrappongono con le dissolvenze. */
export function crossfade(stato, id, sec, ripple) {
  const clips = ordina(stato.clips);
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return { ok: false, motivo: 'Seleziona prima una clip.' };
  const c = clips[i];
  let prec = null;
  for (let k = i - 1; k >= 0; k--) if (Math.abs(fine(clips[k]) - c.start) < 0.05) { prec = clips[k]; break; }
  if (!prec) return { ok: false, motivo: 'A sinistra non c’è una clip attaccata a questa.' };
  if (continue_(prec, c)) return { ok: false, motivo: 'Qui il taglio è continuo: non serve il crossfade.' };
  const x = Math.min(sec, prec.dur * 0.5, c.dur * 0.5);
  if (x < 0.002) return { ok: false, motivo: 'Le clip sono troppo corte.' };
  const fOrig = fine(c);
  c.start = fine(prec) - x;
  prec.fadeOut = Math.max(prec.fadeOut || 0, x);
  c.fadeIn = Math.max(c.fadeIn || 0, x);
  normalizzaFade(prec); normalizzaFade(c);
  if (ripple) for (const k of clips) if (k !== c && k !== prec && k.start >= fOrig - EPS) k.start -= x;
  return { ok: true, sec: x };
}

/** Marcatore: se ce n'è uno vicino a t lo toglie, altrimenti lo aggiunge. Ritorna 'aggiunto' o 'tolto'. */
export function marcatore(stato, t, tolleranza = 0.15) {
  const i = stato.marcatori.findIndex((m) => Math.abs(m - t) <= tolleranza);
  if (i >= 0) { stato.marcatori.splice(i, 1); return 'tolto'; }
  stato.marcatori.push(t);
  stato.marcatori.sort((a, b) => a - b);
  return 'aggiunto';
}

/* ---------- gesti: partono sempre dalle clip originali (orig) e producono la nuova lista ---------- */

/** Sposta una clip a un nuovo istante di inizio. */
export function gestoSposta(orig, id, nuovoStart) {
  const clips = copia(orig);
  const c = trova(clips, id);
  c.start = Math.max(0, nuovoStart);
  return clips;
}

/**
 * Trascina il bordo di una clip di d secondi (positivo = verso destra).
 * Senza magnete il contenuto resta fermo sulla timeline (slip del bordo).
 * Con il magnete la clip resta attaccata a sinistra e quelle dopo scorrono (ripple).
 * durSorgente = durata totale del file, per non uscire dall'audio disponibile.
 */
export function gestoTrim(orig, id, lato, d, ripple, durSorgente) {
  const clips = copia(orig);
  const c = trova(clips, id);
  const o = trova(orig, id);
  const vecchiaFine = fine(o);
  if (lato === 'sx') {
    d = Math.min(Math.max(d, -o.off), o.dur - MIN_DUR);
    c.off = o.off + d;
    c.dur = o.dur - d;
    c.start = ripple ? o.start : o.start + d;
    c.fadeIn = Math.min(o.fadeIn || 0, c.dur);
    if (ripple) for (const x of clips) if (x.id !== id && x.start >= vecchiaFine - EPS) x.start -= d;
  } else {
    d = Math.min(Math.max(d, MIN_DUR - o.dur), durSorgente - (o.off + o.dur));
    c.dur = o.dur + d;
    if (ripple) for (const x of clips) if (x.id !== id && x.start >= vecchiaFine - EPS) x.start += d;
  }
  normalizzaFade(c);
  return clips;
}

/** Imposta la dissolvenza in entrata ('in') o in uscita ('out') di una clip. */
export function gestoFade(orig, id, lato, valore) {
  const clips = copia(orig);
  const c = trova(clips, id);
  if (lato === 'in') { c.fadeIn = valore; c.fadeOut = Math.min(c.fadeOut || 0, Math.max(0, c.dur - Math.max(0, valore) - 0.002)); }
  else c.fadeOut = Math.min(Math.max(0, valore), Math.max(0, c.dur - (c.fadeIn || 0) - 0.002));
  normalizzaFade(c);
  return clips;
}

/** Punti di aggancio (snap) per una clip che si sposta: inizio/fine delle altre clip, 0 e il playhead. */
export function puntiAggancio(clips, escludiId, playhead) {
  const p = [0];
  if (playhead != null) p.push(playhead);
  for (const c of clips) if (c.id !== escludiId) p.push(c.start, fine(c));
  return p;
}

/** Aggancia un valore al punto più vicino se la distanza è entro `soglia` (secondi). */
export function aggancia(valore, punti, soglia) {
  let best = null, dBest = soglia;
  for (const p of punti) { const d = Math.abs(p - valore); if (d <= dBest) { dBest = d; best = p; } }
  return best == null ? valore : best;
}

/* ---------- strumento «Pause» ---------- */

/**
 * Accorcia le pause lunghe. Cerca i tratti sotto soglia più lunghi di `minDur` e li riduce a `mantieni` secondi
 * (togliendo dal centro), poi chiude i buchi. picchi(srcId) → { passo, max } oppure null.
 * Ritorna { pause, rimosso } (numero di pause accorciate, secondi tolti).
 */
export function accorciaPause(stato, picchi, { sogliaDb = -45, minDur = 0.8, mantieni = 0.4 } = {}) {
  const soglia = Math.pow(10, sogliaDb / 20);
  const clips = ordina(copia(stato.clips));
  const nuove = [];
  let spostamento = 0, pause = 0;
  for (const c of clips) {
    const pk = picchi(c.src);
    const tagli = [];
    if (pk) {
      const { passo, max } = pk;
      const b0 = Math.floor(c.off / passo), b1 = Math.min(max.length, Math.ceil((c.off + c.dur) / passo));
      let ini = -1;
      const chiudi = (bFine) => {
        const rs = Math.max(c.off, ini * passo), re = Math.min(c.off + c.dur, bFine * passo);
        if (re - rs >= minDur && re - rs - mantieni >= 0.02) tagli.push([rs + mantieni / 2, re - mantieni / 2]);
      };
      for (let b = b0; b < b1; b++) {
        if (max[b] < soglia) { if (ini < 0) ini = b; }
        else if (ini >= 0) { chiudi(b); ini = -1; }
      }
      if (ini >= 0) chiudi(b1);
    }
    let cursore = c.off;
    const pezzi = [];
    for (const [a, b] of tagli) { pezzi.push([cursore, a]); cursore = b; }
    pezzi.push([cursore, c.off + c.dur]);
    pezzi.forEach(([a, b], k) => {
      if (b - a >= MIN_DUR) {
        const p = {
          ...c, id: k === 0 ? c.id : nuovoId(), off: a, dur: b - a,
          start: c.start + (a - c.off) - spostamento,
          fadeIn: k === 0 ? c.fadeIn : 0, fadeOut: k === pezzi.length - 1 ? c.fadeOut : 0,
        };
        nuove.push(normalizzaFade(p));
      }
      if (k < tagli.length) { spostamento += tagli[k][1] - tagli[k][0]; pause++; }
    });
  }
  const rimosso = spostamento;
  stato.clips = ordina(nuove);
  return { pause, rimosso };
}

/* ---------- cronologia (annulla / ripristina) ---------- */

export function nuovaStoria(max = 100) {
  const undo = [], redo = [];
  const snap = (s) => JSON.stringify({ clips: s.clips, marcatori: s.marcatori });
  return {
    /** Da chiamare PRIMA di modificare lo stato. */
    salva(s) { undo.push(snap(s)); if (undo.length > max) undo.shift(); redo.length = 0; },
    /** Se dopo un gesto non è cambiato nulla, toglie l'ultimo salvataggio inutile. */
    scartaSeUguale(s) { if (undo.length && undo[undo.length - 1] === snap(s)) undo.pop(); },
    annulla(s) { if (!undo.length) return false; redo.push(snap(s)); Object.assign(s, JSON.parse(undo.pop())); return true; },
    ripristina(s) { if (!redo.length) return false; undo.push(snap(s)); Object.assign(s, JSON.parse(redo.pop())); return true; },
    puoAnnullare: () => undo.length > 0,
    puoRipristinare: () => redo.length > 0,
    svuota() { undo.length = 0; redo.length = 0; },
  };
}
