// Prova rapida della logica di montaggio: node scripts/prova-modello.mjs
import assert from 'node:assert/strict';
import * as M from '../app/modello.js';

const stato = { clips: [{ id: 'a', src: 's1', nome: 'x', start: 0, off: 0, dur: 10, fadeIn: 0, fadeOut: 0 }], marcatori: [] };

// taglio
const dx = M.taglia(stato, 4);
assert.equal(stato.clips.length, 2);
assert.equal(M.trova(stato.clips, dx).off, 4);
assert.equal(M.taglia(stato, 4.01), null, 'troppo vicino al taglio');
// taglio continuo: nessun declick sul punto di taglio
const dur = () => 10; // il file sorgente dura 10 s
const f = M.fadeEffettivi(stato.clips, dur);
assert.equal(f.get('a').fo, 0); assert.equal(f.get(dx).fi, 0);
// inizio e fine naturali del file: nessuna dissolvenza, l'audio esce identico
assert.equal(f.get('a').fi, 0); assert.equal(f.get(dx).fo, 0);

// elimina con ripple: la clip a sinistra resta, il buco si chiude
M.taglia(stato, 7);
const [c0, c1, c2] = stato.clips;
M.elimina(stato, c1.id, true);
assert.equal(stato.clips.length, 2);
assert.ok(Math.abs(stato.clips[1].start - 4) < 1e-9, 'la clip dopo scorre a sinistra');
assert.ok(Math.abs(M.durataTotale(stato.clips) - 7) < 1e-9);
// ora il taglio non è più continuo: declick sul punto
const f2 = M.fadeEffettivi(stato.clips, dur);
assert.equal(f2.get(c0.id).fo, M.DECLICK);
assert.equal(f2.get(c0.id).fi, 0);

// crossfade
const r = M.crossfade(stato, c2.id, 0.08, true);
assert.ok(r.ok, r.motivo);
assert.ok(Math.abs(M.trova(stato.clips, c2.id).start - (4 - 0.08)) < 1e-9);
const fx = M.fadeEffettivi(stato.clips, dur);
assert.ok(fx.get(c0.id).fo >= 0.08 - 1e-9 && fx.get(c2.id).fi >= 0.08 - 1e-9, 'la sovrapposizione crea il crossfade a X');
// separando le clip il crossfade sparisce da solo
const sep = M.copia(stato.clips); M.trova(sep, c2.id).start += 1;
assert.ok(M.fadeEffettivi(sep, dur).get(c0.id).fo < 0.01, 'senza sovrapposizione niente crossfade');
// una clip tutta dentro un'altra non è un crossfade
const dentro = [{ id: 'A', src: 's', nome: 'A', start: 0, off: 0, dur: 10, fadeIn: 0, fadeOut: 0 }, { id: 'B', src: 's', nome: 'B', start: 2, off: 0, dur: 3, fadeIn: 0, fadeOut: 0 }];
assert.equal(M.sovrapposizioni(dentro).length, 0);
// sovrapposizione fatta a mano (trascinando): 0,3 s
const mano = [{ id: 'A', src: 's', nome: 'A', start: 0, off: 0, dur: 5, fadeIn: 0, fadeOut: 0 }, { id: 'B', src: 's', nome: 'B', start: 4.7, off: 0, dur: 5, fadeIn: 0, fadeOut: 0 }];
const fm = M.fadeAutomatici(mano);
assert.ok(Math.abs(fm.get('A').fo - 0.3) < 1e-9 && Math.abs(fm.get('B').fi - 0.3) < 1e-9);

// gesti: trim con ripple (a sinistra attaccata) e senza
const base = M.copia(stato.clips);
const t1 = M.gestoTrim(base, c2.id, 'sx', 1, true, 10);
assert.ok(Math.abs(M.trova(t1, c2.id).start - M.trova(base, c2.id).start) < 1e-9);
assert.ok(Math.abs(M.trova(t1, c2.id).off - (M.trova(base, c2.id).off + 1)) < 1e-9);
const t2 = M.gestoTrim(base, c2.id, 'sx', 1, false, 10);
assert.ok(Math.abs(M.trova(t2, c2.id).start - (M.trova(base, c2.id).start + 1)) < 1e-9);
const t3 = M.gestoTrim(base, c0.id, 'dx', 100, false, 10);
assert.ok(M.fine(M.trova(t3, c0.id)) <= 10 + 1e-9 + 0, 'non oltre il file');
assert.ok(M.trova(t3, c0.id).off + M.trova(t3, c0.id).dur <= 10 + 1e-9);

// fade
const g = M.gestoFade(base, c0.id, 'in', 99);
assert.ok(M.trova(g, c0.id).fadeIn < M.trova(g, c0.id).dur);
assert.ok(Math.abs(M.guadagno({ start: 0, dur: 1 }, 0.5, 0, 0.25) - Math.sin(Math.PI / 4)) < 1e-9);

// marcatori
assert.equal(M.marcatore(stato, 3), 'aggiunto');
assert.equal(M.marcatore(stato, 3.05), 'tolto');

// pause: 10 s di file con parlato 0-2, silenzio 2-6, parlato 6-10 (bucket da 0,1 s)
const max = new Float32Array(100).fill(0.5); for (let i = 20; i < 60; i++) max[i] = 0.0001;
const s2 = { clips: [{ id: 'p', src: 's', nome: 'p', start: 0, off: 0, dur: 10, fadeIn: 0, fadeOut: 0 }], marcatori: [] };
const out = M.accorciaPause(s2, () => ({ passo: 0.1, max }), { sogliaDb: -45, minDur: 0.8, mantieni: 0.4 });
assert.equal(out.pause, 1);
assert.ok(Math.abs(out.rimosso - 3.6) < 1e-9, 'rimosso ' + out.rimosso);
assert.ok(Math.abs(M.durataTotale(s2.clips) - 6.4) < 1e-9);
assert.equal(s2.clips.length, 2);

// storia
const st = M.nuovaStoria();
const s3 = { clips: [], marcatori: [] };
st.salva(s3); s3.marcatori.push(1);
assert.ok(st.annulla(s3)); assert.deepEqual(s3.marcatori, []);
assert.ok(st.ripristina(s3)); assert.deepEqual(s3.marcatori, [1]);
console.log('ok: tutte le prove del modello passano');
