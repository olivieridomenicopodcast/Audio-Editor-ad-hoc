// audio.js - Web Audio: decodifica, picchi per la forma d'onda, riproduzione, rendering ed export WAV.
import { fine, fadeEffettivi, guadagno, durataTotale } from './modello.js';

const durSrc = (buffers) => (id) => buffers.get(id)?.duration ?? Infinity;

let ctx = null;
export function contesto() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

const decodifica = (arrayBuffer) => contesto().decodeAudioData(arrayBuffer);

/**
 * Legge un WAV PCM (16/24/32 bit) o float32 campione per campione, senza passare dal decodificatore del browser
 * (che cambia leggermente la scala e a volte ricampiona). Ritorna un AudioBuffer oppure null se il formato non è supportato.
 */
function leggiWav(ab) {
  const v = new DataView(ab);
  if (v.byteLength < 44 || v.getUint32(0) !== 0x52494646 || v.getUint32(8) !== 0x57415645) return null;
  let fmt = null, dOff = -1, dLen = 0;
  for (let o = 12; o + 8 <= v.byteLength;) {
    const id = v.getUint32(o), sz = v.getUint32(o + 4, true);
    if (id === 0x666d7420) {
      fmt = { tag: v.getUint16(o + 8, true), ch: v.getUint16(o + 10, true), sr: v.getUint32(o + 12, true), bit: v.getUint16(o + 22, true) };
      if (fmt.tag === 0xfffe && sz >= 40) fmt.tag = v.getUint16(o + 32, true); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 0x64617461) { dOff = o + 8; dLen = Math.min(sz, v.byteLength - dOff); break; }
    o += 8 + sz + (sz & 1);
  }
  if (!fmt || dOff < 0) return null;
  const intero = fmt.tag === 1 && (fmt.bit === 16 || fmt.bit === 24 || fmt.bit === 32), mobile = fmt.tag === 3 && fmt.bit === 32;
  if (!(intero || mobile) || fmt.ch < 1 || fmt.ch > 8) return null;
  const bps = fmt.bit / 8, len = Math.floor(dLen / (bps * fmt.ch));
  if (len < 1) return null;
  const buf = new AudioBuffer({ length: len, numberOfChannels: fmt.ch, sampleRate: fmt.sr });
  for (let ch = 0; ch < fmt.ch; ch++) {
    const d = new Float32Array(len);
    for (let i = 0, o = dOff + ch * bps; i < len; i++, o += bps * fmt.ch) {
      d[i] = mobile ? v.getFloat32(o, true)
        : fmt.bit === 16 ? v.getInt16(o, true) / 32768
        : fmt.bit === 24 ? ((v.getUint8(o) | v.getUint8(o + 1) << 8 | v.getUint8(o + 2) << 16) << 8 >> 8) / 8388608
        : v.getInt32(o, true) / 2147483648;
    }
    buf.copyToChannel(d, ch);
  }
  return buf;
}

/** Apre un file audio: i WAV vengono letti campione per campione, gli altri formati (mp3, m4a…) dal decodificatore del browser. */
export async function decodificaFile(ab) {
  try { const w = leggiWav(ab); if (w) return w; } catch { /* formato strano: ripiega sul decodificatore */ }
  return decodifica(ab);
}

/** Porta un AudioBuffer a un'altra frequenza di campionamento (solo se i file del progetto hanno frequenze diverse). */
export async function ricampiona(buf, rate) {
  const oc = new OfflineAudioContext(buf.numberOfChannels, Math.ceil(buf.duration * rate), rate);
  const src = oc.createBufferSource();
  src.buffer = buf; src.connect(oc.destination); src.start();
  return oc.startRendering();
}

const BUCKET = 64; // campioni per punto di forma d'onda

/** Picchi min/max (per la forma d'onda) e massimo assoluto (per le pause), mixando tutti i canali. */
export function calcolaPicchi(buf) {
  const n = Math.ceil(buf.length / BUCKET);
  const min = new Float32Array(n), max = new Float32Array(n), ass = new Float32Array(n);
  const canali = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  for (let b = 0; b < n; b++) {
    let lo = 0, hi = 0;
    const a = b * BUCKET, z = Math.min(buf.length, a + BUCKET);
    for (const d of canali) for (let i = a; i < z; i++) { const v = d[i]; if (v < lo) lo = v; else if (v > hi) hi = v; }
    min[b] = lo; max[b] = hi; ass[b] = Math.max(hi, -lo);
  }
  return { passo: BUCKET / buf.sampleRate, min, max, ass };
}

/**
 * Programma la riproduzione su un contesto (reale o offline).
 * t0 = istante della timeline da cui partire · quando = istante del contesto in cui far partire t0
 * solo = Set di id da suonare (null = tutte). Ritorna i nodi sorgente, per poterli fermare.
 */
export function programma(c2, clips, buffers, t0, quando, solo = null) {
  const fade = fadeEffettivi(clips, durSrc(buffers));
  const nodi = [];
  for (const c of clips) {
    if (solo && !solo.has(c.id)) continue;
    const buf = buffers.get(c.src);
    if (!buf || fine(c) <= t0 + 1e-6) continue;
    const { fi, fo } = fade.get(c.id);
    const da = Math.max(c.start, t0);
    const src = c2.createBufferSource();
    src.buffer = buf;
    const g = c2.createGain();
    g.gain.value = guadagno(c, fi, fo, da);
    src.connect(g).connect(c2.destination);
    const curva = (a, z) => { // dissolvenza sulla finestra [a, z] della timeline
      const n = Math.min(400, Math.max(2, Math.ceil((z - a) * 400)));
      const v = new Float32Array(n);
      for (let k = 0; k < n; k++) v[k] = guadagno(c, fi, fo, a + (z - a) * k / (n - 1));
      g.gain.setValueCurveAtTime(v, quando + (a - t0), z - a);
    };
    if (fi > 0 && t0 < c.start + fi - 1e-4) curva(Math.max(c.start, t0), c.start + fi);
    if (fo > 0 && t0 < fine(c) - 1e-4) curva(Math.max(fine(c) - fo, t0, c.start + fi + 1e-3), fine(c));
    src.start(quando + (da - t0), c.off + (da - c.start), fine(c) - da);
    nodi.push(src);
  }
  return nodi;
}

/**
 * Calcola il montaggio per l'export SENZA passare dal Web Audio: copia i campioni uno per uno.
 * Dove non ci sono dissolvenze i campioni escono identici a quelli del file originale (nessun ricampionamento,
 * nessun guadagno, nessun filtro). Ritorna un oggetto simile ad AudioBuffer.
 */
export function renderizzaDiretto(clips, buffers, { da = 0, a = null, rate, canali = 2, solo = null } = {}) {
  const fineT = a ?? durataTotale(clips);
  const f0 = Math.round(da * rate), len = Math.max(1, Math.round(fineT * rate) - f0);
  const out = Array.from({ length: canali }, () => new Float32Array(len));
  const fade = fadeEffettivi(clips, durSrc(buffers));
  for (const c of clips) {
    if (solo && !solo.has(c.id)) continue;
    const buf = buffers.get(c.src);
    if (!buf) continue;
    const { fi, fo } = fade.get(c.id);
    const s0 = Math.round(c.start * rate), o0 = Math.round(c.off * rate);
    const n = Math.min(Math.round(fine(c) * rate) - s0, buf.length - o0);
    const nfi = Math.round(fi * rate), nfo = Math.round(fo * rate);
    const k0 = Math.max(0, f0 - s0), k1 = Math.min(n, len + f0 - s0);
    for (let ch = 0; ch < canali; ch++) {
      const sorg = buf.getChannelData(buf.numberOfChannels === 1 ? 0 : Math.min(ch, buf.numberOfChannels - 1));
      const dst = out[ch];
      for (let k = k0; k < k1; k++) {
        let v = sorg[o0 + k];
        if (k < nfi) v *= Math.sin(k / nfi * Math.PI / 2);
        if (n - k < nfo) v *= Math.sin((n - k) / nfo * Math.PI / 2);
        dst[s0 + k - f0] += v;
      }
    }
  }
  return { numberOfChannels: canali, length: len, sampleRate: rate, getChannelData: (i) => out[i] };
}

/** Codifica in WAV (accetta un AudioBuffer o l'oggetto di renderizzaDiretto). bit: 16, 24 oppure 32 (virgola mobile). Ritorna un Blob. */
export function codificaWav(buf, bit = 24) {
  const nc = buf.numberOfChannels, len = buf.length, bps = bit / 8;
  const dati = len * nc * bps;
  const ab = new ArrayBuffer(44 + dati);
  const v = new DataView(ab);
  const scrivi = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  scrivi(0, 'RIFF'); v.setUint32(4, 36 + dati, true); scrivi(8, 'WAVE'); scrivi(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, bit === 32 ? 3 : 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * nc * bps, true);
  v.setUint16(32, nc * bps, true); v.setUint16(34, bit, true); scrivi(36, 'data'); v.setUint32(40, dati, true);
  const canali = Array.from({ length: nc }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let k = 0; k < nc; k++) {
      const x = Math.max(-1, Math.min(1, canali[k][i]));
      if (bit === 16) { v.setInt16(o, Math.min(32767, Math.round(x * 32768)), true); o += 2; }
      else if (bit === 24) {
        const n = Math.min(8388607, Math.round(x * 8388608));
        v.setUint8(o, n & 255); v.setUint8(o + 1, (n >> 8) & 255); v.setUint8(o + 2, (n >> 16) & 255); o += 3;
      } else { v.setFloat32(o, x, true); o += 4; }
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
