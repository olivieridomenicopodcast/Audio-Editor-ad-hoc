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

// ---- fade automatico sui tagli: vale solo per i tagli NUOVI ----
{
  const dur10 = () => 10, N = 0.2;
  const nuovo = (imp) => ({ clips: [{ id: 'a', src: 's', nome: 'x', start: 0, off: 0, dur: 10, fadeIn: 0, fadeOut: 0 }], marcatori: [], fadeTaglio: imp });
  const acceso = { attivo: true, ms: 200 };
  // taglio con l'impostazione accesa e metà ancora attaccate: NESSUN fade (niente buco di volume)
  const st2 = nuovo(acceso); const r1 = M.taglia(st2, 4);
  let f = M.fadeEffettivi(st2.clips, dur10);
  assert.equal(f.get('a').fo, 0); assert.equal(f.get(r1).fi, 0);
  // secondo taglio e tolgo il pezzo in mezzo (ripple): fade di 0,2 s sui due bordi rimasti
  const r2 = M.taglia(st2, 6); const mezzo = M.clipA(st2.clips, 5).id; M.elimina(st2, mezzo, true);
  f = M.fadeEffettivi(st2.clips, dur10);
  assert.ok(Math.abs(f.get('a').fo - N) < 1e-9, 'la clip a sinistra sfuma in uscita');
  assert.ok(Math.abs(f.get(r2).fi - N) < 1e-9, 'la clip a destra sfuma in entrata');
  assert.equal(f.get('a').fi, 0, 'l\'inizio naturale del file non si tocca');
  assert.equal(f.get(r2).fo, 0, 'la fine naturale del file non si tocca');

  // *** TAGLI VECCHI: un progetto con tagli fatti senza il fade non cambia, anche se l'impostazione si accende dopo ***
  const vecchio = nuovo({ attivo: false, ms: 200 }); M.taglia(vecchio, 4); M.taglia(vecchio, 6);
  M.elimina(vecchio, M.clipA(vecchio.clips, 5).id, true);
  vecchio.fadeTaglio = acceso;                                   // lo accendo adesso
  const fv = M.fadeEffettivi(vecchio.clips, dur10);
  for (const c of vecchio.clips) assert.ok(fv.get(c.id).fi <= M.DECLICK + 1e-12 && fv.get(c.id).fo <= M.DECLICK + 1e-12, 'i tagli vecchi restano col solo declick');
  // ...e un taglio fatto DOPO averlo acceso ha il fade, mentre quelli vecchi no
  const nuovoTaglio = M.taglia(vecchio, 7.5); const dopo = M.clipA(vecchio.clips, 7.6);
  M.elimina(vecchio, dopo.id, true);
  const fv2 = M.fadeEffettivi(vecchio.clips, dur10);
  const sx = vecchio.clips.find((c) => c.ftDx === N);
  assert.ok(sx && Math.abs(fv2.get(sx.id).fo - N) < 1e-9, 'il bordo del taglio nuovo ha il fade');
  void nuovoTaglio;

  // dissolvenza scelta a mano (anche più corta) ha la precedenza
  st2.clips.find((c) => c.id === 'a').fadeOut = 0.05;
  assert.ok(Math.abs(M.fadeEffettivi(st2.clips, dur10).get('a').fo - 0.05) < 1e-9);
  // trascinando a zero resta una dissolvenza esplicita di 1 ms (non torna quella automatica)
  const g0 = M.gestoFade(st2.clips, 'a', 'out', 0);
  assert.ok(M.trova(g0, 'a').fadeOut > 0 && M.trova(g0, 'a').fadeOut <= 0.001 + 1e-12);
  // il trim di un bordo è un taglio nuovo: scrive il fade; senza ft il bordo non si tocca
  const bT = M.gestoTrim([{ id: 'T', src: 's', nome: 'T', start: 0, off: 1, dur: 4, fadeIn: 0, fadeOut: 0 }], 'T', 'dx', -1, false, 10, 0.2);
  assert.equal(M.trova(bT, 'T').ftDx, 0.2);
  assert.equal(M.trova(M.gestoTrim([{ id: 'T', src: 's', nome: 'T', start: 0, off: 1, dur: 4, fadeIn: 0, fadeOut: 0 }], 'T', 'dx', -1, false, 10), 'T').ftDx, undefined);
  // dove c'è un crossfade a X vince la sovrapposizione, non il fade sui tagli
  const x = [{ id: 'A', src: 's', nome: 'A', start: 0, off: 1, dur: 5, fadeIn: 0, fadeOut: 0, ftDx: N }, { id: 'B', src: 's', nome: 'B', start: 4.9, off: 2, dur: 3, fadeIn: 0, fadeOut: 0, ftSx: N }];
  const fx2 = M.fadeEffettivi(x, dur10);
  assert.ok(Math.abs(fx2.get('A').fo - 0.1) < 1e-9 && Math.abs(fx2.get('B').fi - 0.1) < 1e-9, 'sovrapposizione: 0,1 s, non 0,2 s');
  // clip corte: i fade si rimpiccioliscono, non si sovrappongono
  const corta = [{ id: 'C', src: 's', nome: 'C', start: 0, off: 1, dur: 0.1, fadeIn: 0, fadeOut: 0, ftSx: N, ftDx: N }];
  const fc = M.fadeEffettivi(corta, dur10).get('C'); assert.ok(fc.fi + fc.fo <= 0.1);
  // migrazione dei progetti della build 14 («acceso» per tutti i bordi)
  const mig = [{ id: 'M', src: 's', nome: 'M', start: 0, off: 1, dur: 2, fadeIn: 0, fadeOut: 0 }];
  assert.equal(M.migraFadeTaglio(mig, 0.2), true); assert.equal(mig[0].ftSx, 0.2); assert.equal(mig[0].ftDx, 0.2);
  assert.equal(M.migraFadeTaglio(mig, 0.2), false, 'non cambia due volte');
  assert.equal(M.migraFadeTaglio([{ id: 'Z', src: 's', start: 0, off: 0, dur: 1 }], 0), false, 'spento: niente da migrare');
  // le pause tagliate con l'impostazione accesa hanno il fade sui bordi interni, ma non su inizio/fine
  const max = new Float32Array(100).fill(0.5); for (let i = 20; i < 60; i++) max[i] = 0.0001;
  const sp = { clips: [{ id: 'p', src: 's', nome: 'p', start: 0, off: 0, dur: 10, fadeIn: 0, fadeOut: 0 }], marcatori: [] };
  M.accorciaPause(sp, () => ({ passo: 0.1, max }), { sogliaDb: -45, minDur: 0.8, mantieni: 0.4, fadeTaglio: N });
  const [pa, pb] = sp.clips; assert.equal(pa.ftDx, N); assert.equal(pb.ftSx, N); assert.equal(pa.ftSx, undefined); assert.equal(pb.ftDx, undefined);
  assert.ok(Math.abs(M.fadeEffettivi(sp.clips, () => 10).get(pa.id).fo - N) < 1e-9);
}
console.log('ok: fade sui tagli (solo tagli nuovi)');

// ---- magnete con distanza (0–1000 ms) ----
{
  const D = 0.15;
  const base = () => [
    { id: 'A', src: 's', nome: 'A', start: 0, off: 0, dur: 5, fadeIn: 0, fadeOut: 0 },
    { id: 'B', src: 's', nome: 'B', start: 5, off: 5, dur: 3, fadeIn: 0, fadeOut: 0 },
    { id: 'C', src: 's2', nome: 'C', start: 10, off: 0, dur: 2, fadeIn: 0, fadeOut: 0 },   // dopo B c'è GIÀ un buco di 2 s (8 → 10)
  ];
  // distanza 0: identico a prima (ripple in diretta, attaccate del tutto)
  let o = base(), c = M.gestoTrim(o, 'A', 'dx', -1.2, true, 10, null, 0);
  assert.ok(Math.abs(M.trova(c, 'B').start - 3.8) < 1e-9 && Math.abs(M.trova(c, 'C').start - 8.8) < 1e-9, 'distanza 0: come sempre');
  // distanza 150 ms, accorcio la coda di A di 1,2 s: mentre trascino NON si sposta niente...
  c = M.gestoTrim(o, 'A', 'dx', -1.2, true, 10, null, D);
  assert.equal(M.trova(c, 'B').start, 5); assert.equal(M.trova(c, 'C').start, 10);
  // ...al rilascio B e C si avvicinano lasciando 150 ms; il buco di 2 s tra B e C resta di 2 s
  assert.equal(M.chiudiConDistanza(c, o, 'A', 'dx', D), true);
  assert.ok(Math.abs(M.trova(c, 'B').start - (M.fine(M.trova(c, 'A')) + D)) < 1e-9, 'B a 150 ms da A');
  assert.ok(Math.abs(M.trova(c, 'C').start - M.fine(M.trova(c, 'B')) - 2) < 1e-9, 'il buco vecchio tra B e C non si tocca');
  // un trim che toglie meno della distanza non sposta niente
  c = M.gestoTrim(o, 'A', 'dx', -0.1, true, 10, null, D);
  assert.equal(M.chiudiConDistanza(c, o, 'A', 'dx', D), false); assert.equal(M.trova(c, 'B').start, 5);
  // allungare la coda resta un ripple in diretta (le clip dopo seguono, spazi vecchi compresi)
  c = M.gestoTrim(o, 'B', 'dx', 0.5, true, 10, null, D);
  assert.ok(Math.abs(M.trova(c, 'C').start - 10.5) < 1e-9);
  // bordo sinistro: tolgo 1 s dalla testa di B → B resta a 150 ms da A, e C scorre di conseguenza
  c = M.gestoTrim(o, 'B', 'sx', 1, true, 10, null, D);
  assert.ok(Math.abs(M.trova(c, 'B').start - 6) < 1e-9, 'durante il trascinamento il contenuto resta fermo');
  assert.equal(M.chiudiConDistanza(c, o, 'B', 'sx', D), true);
  assert.ok(Math.abs(M.trova(c, 'B').start - (5 + D)) < 1e-9, 'B a 150 ms da A');
  assert.ok(Math.abs(M.trova(c, 'C').start - (M.fine(M.trova(c, 'B')) + 2)) < 1e-9, 'e il buco vecchio fino a C resta di 2 s');
  // elimina con distanza: B (3 s) sostituita da 150 ms di spazio; il buco vecchio fino a C resta
  const st3 = { clips: base(), marcatori: [] };
  M.elimina(st3, 'B', true, D);
  assert.ok(Math.abs(M.trova(st3.clips, 'C').start - (10 - (3 - D))) < 1e-9);
  // elimina di un pezzo più corto della distanza: niente spostamento
  const st4 = { clips: [{ id: 'X', src: 's', nome: 'X', start: 0, off: 0, dur: 0.1, fadeIn: 0, fadeOut: 0 }, { id: 'Y', src: 's', nome: 'Y', start: 0.1, off: 1, dur: 2, fadeIn: 0, fadeOut: 0 }], marcatori: [] };
  M.elimina(st4, 'X', true, D); assert.equal(M.trova(st4.clips, 'Y').start, 0.1);
  // elimina a distanza 0: come sempre
  const st5 = { clips: base(), marcatori: [] }; M.elimina(st5, 'B', true, 0);
  assert.ok(Math.abs(M.trova(st5.clips, 'C').start - 7) < 1e-9);
}
console.log('ok: magnete con distanza');
