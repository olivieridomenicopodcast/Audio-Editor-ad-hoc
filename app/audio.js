// audio.js - Web Audio: decodifica, picchi per la forma d'onda, riproduzione, rendering ed export WAV.
import { fine, fadeEffettivi, guadagno, durataTotale } from './modello.js';

let ctx = null;
export function contesto() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export const decodifica = (arrayBuffer) => contesto().decodeAudioData(arrayBuffer);

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
  const fade = fadeEffettivi(clips);
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

/** Calcola il montaggio fuori dal tempo reale. Ritorna un AudioBuffer. */
export async function renderizza(clips, buffers, { da = 0, a = null, rate, canali = 2, solo = null } = {}) {
  const fineT = a ?? durataTotale(clips);
  const len = Math.max(1, Math.ceil((fineT - da) * rate));
  const oc = new OfflineAudioContext(canali, len, rate);
  programma(oc, clips, buffers, da, 0, solo);
  return oc.startRendering();
}

/** Codifica un AudioBuffer in WAV. bit: 16, 24 oppure 32 (virgola mobile). Ritorna un Blob. */
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
      if (bit === 16) { v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
      else if (bit === 24) {
        const n = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff);
        v.setUint8(o, n & 255); v.setUint8(o + 1, (n >> 8) & 255); v.setUint8(o + 2, (n >> 16) & 255); o += 3;
      } else { v.setFloat32(o, x, true); o += 4; }
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
