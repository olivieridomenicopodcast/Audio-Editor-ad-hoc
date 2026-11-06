// github.js - sincronizzazione dei PROGETTI con un repo GitHub (push = invia, pull = riprendi).
// Si sincronizzano solo i dati di montaggio (nomi dei file, tagli, fade, marcatori): MAI l'audio.
// Il token resta SOLO in questo telefono (localStorage): non finisce mai nel repo né nei log.
const CHIAVE = 'aeah-gh-v1';
export const GH_DEF = { token: '', repo: 'olivieridomenicopodcast/Audio-Editor-ad-hoc', branch: 'main', cartella: 'progetti', api: 'https://api.github.com' };

export function leggiConfig() {
  try { return { ...GH_DEF, ...(JSON.parse(localStorage.getItem(CHIAVE)) || {}) }; } catch { return { ...GH_DEF }; }
}
export function salvaConfig(c) { try { localStorage.setItem(CHIAVE, JSON.stringify(c)); } catch { /* spazio finito */ } }

/** Ritorna un messaggio se le impostazioni non vanno bene, altrimenti null. */
export function controllaConfig(c) {
  if (!c.token) return 'Inserisci prima il token GitHub.';
  if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo)) return 'Il repository va scritto così: utente/nome-repo.';
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(c.cartella) || c.cartella.split('/').some((p) => p === '..' || p === '.')) return 'Il nome della cartella non è valido.';
  if (!/^[\w./-]+$/.test(c.branch)) return 'Il nome del ramo non è valido.';
  return null;
}

export function spiegaErrore(e) {
  if (e && e.status === 401) return 'Token non valido o scaduto: controllalo nelle impostazioni di GitHub.';
  if (e && e.status === 403) return 'Il token non ha il permesso (serve «Contents: Read and write» su questo repo) oppure hai fatto troppe richieste.';
  if (e && e.status === 404) return 'Repo o ramo non trovato: controlla il nome e che il token abbia accesso al repo.';
  if (e && (e.status === 409 || e.status === 422)) return 'GitHub è cambiato nel frattempo: riprova.';
  if (e instanceof TypeError) return 'Nessuna connessione a GitHub.';
  return 'Errore di GitHub: ' + (e && e.message ? e.message : e);
}

async function chiama(c, percorso, opz = {}) {
  const r = await fetch(c.api + percorso, {
    cache: 'no-store', ...opz,
    headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opz.json ? { 'Content-Type': 'application/json' } : {}), ...(opz.headers || {}) },
    body: opz.json ? JSON.stringify(opz.json) : opz.body,
  });
  if (!r.ok) { const e = new Error(`${r.status}`); e.status = r.status; throw e; }
  return r;
}

/** Controlla che il token funzioni e possa scrivere nel repo. */
export async function provaToken(c) {
  const r = await (await chiama(c, `/repos/${c.repo}`)).json();
  return { puoScrivere: !!(r.permissions && r.permissions.push), nome: r.full_name || c.repo };
}

function inBase64(u8) {
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Legge dal repo tutti i progetti: [{ id, rec }] (rec = oggetto grezzo, da validare prima di usarlo). */
export async function leggiRemoti(c, stato = () => {}) {
  let elenco;
  try { elenco = await (await chiama(c, `/repos/${c.repo}/contents/${c.cartella}?ref=${encodeURIComponent(c.branch)}`)).json(); }
  catch (e) { if (e.status === 404) return []; throw e; }
  const file = (Array.isArray(elenco) ? elenco : []).filter((x) => x.type === 'file' && /^[\w-]+\.json$/.test(x.name));
  const out = [];
  for (let i = 0; i < file.length; i++) {
    stato(`Leggo i progetti… ${i + 1}/${file.length}`);
    try {
      const testo = await (await chiama(c, `/repos/${c.repo}/contents/${c.cartella}/${file[i].name}?ref=${encodeURIComponent(c.branch)}`, { headers: { Accept: 'application/vnd.github.raw+json' } })).text();
      out.push({ id: file[i].name.replace(/\.json$/, ''), rec: JSON.parse(testo) });
    } catch (e) { if (e.status && e.status !== 404) throw e; /* file rovinato: lo ignoro */ }
  }
  return out;
}

/**
 * Invia i progetti locali con UN solo commit. Non sovrascrive un progetto se sul repo è più recente
 * (finisce in `saltati`: fai prima Pull). I progetti cancellati sul telefono (`cancellati`) vengono tolti dal repo.
 * locali: [{ id, nome, aggiornato, ... }]
 */
export async function pushProgetti(c, locali, cancellati, stato = () => {}) {
  for (let tentativo = 0; ; tentativo++) {
    try {
      stato('Leggo lo stato del repo…');
      const remoti = new Map((await leggiRemoti(c, stato)).map((x) => [x.id, x.rec]));
      const rep = `/repos/${c.repo}`;
      const head = (await (await chiama(c, `${rep}/git/ref/heads/${c.branch}`)).json()).object.sha;
      const baseTree = (await (await chiama(c, `${rep}/git/commits/${head}`)).json()).tree.sha;
      const voci = [], saltati = [], inviati = [];
      for (const p of locali) {
        const r = remoti.get(p.id);
        if (r && (r.aggiornato || 0) > (p.aggiornato || 0)) { saltati.push(p.nome); continue; }
        stato(`Carico «${p.nome}»…`);
        const dati = new TextEncoder().encode(JSON.stringify(p, null, 1) + '\n');
        const b = await (await chiama(c, `${rep}/git/blobs`, { method: 'POST', json: { content: inBase64(dati), encoding: 'base64' } })).json();
        voci.push({ path: `${c.cartella}/${p.id}.json`, mode: '100644', type: 'blob', sha: b.sha });
        inviati.push(p.nome);
      }
      let tolti = 0;
      for (const id of cancellati) if (remoti.has(id)) { voci.push({ path: `${c.cartella}/${id}.json`, mode: '100644', type: 'blob', sha: null }); tolti++; }
      if (!voci.length) return { cambiato: false, inviati, saltati, tolti };
      stato('Preparo l\'aggiornamento…');
      const albero = await (await chiama(c, `${rep}/git/trees`, { method: 'POST', json: { base_tree: baseTree, tree: voci } })).json();
      if (albero.sha === baseTree) return { cambiato: false, inviati, saltati, tolti };
      const nc = await (await chiama(c, `${rep}/git/commits`, { method: 'POST', json: { message: `Progetti Audio Editor: aggiornamento dall'app (${inviati.length} inviati${tolti ? `, ${tolti} tolti` : ''})`, tree: albero.sha, parents: [head] } })).json();
      await chiama(c, `${rep}/git/refs/heads/${c.branch}`, { method: 'PATCH', json: { sha: nc.sha } });
      return { cambiato: true, inviati, saltati, tolti };
    } catch (e) {
      if (tentativo < 1 && (e.status === 422 || e.status === 409)) continue; // il ramo si è mosso: un secondo tentativo
      throw e;
    }
  }
}
