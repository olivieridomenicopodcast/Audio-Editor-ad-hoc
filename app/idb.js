// idb.js - salva i progetti e i file audio sul telefono (IndexedDB), così al riavvio ritrovi tutto.
//   progetti → un record per progetto (clip, marcatori, impostazioni; NON l'audio)
//   audio    → i file audio importati (uno per sorgente, condivisi tra progetti)
//   progetto → piccole impostazioni (quale progetto è aperto)
const NOME = 'audio-editor-ad-hoc';
let dbp;

function db() {
  if (!dbp) {
    dbp = new Promise((ok, ko) => {
      const r = indexedDB.open(NOME, 2);
      r.onupgradeneeded = () => { for (const n of ['progetto', 'audio', 'progetti']) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
  }
  return dbp;
}

async function tx(negozio, mode, fn) {
  try {
    const d = await db();
    return await new Promise((ok, ko) => {
      const t = d.transaction(negozio, mode);
      const req = fn(t.objectStore(negozio));
      t.oncomplete = () => ok(req?.result);
      t.onerror = () => ko(t.error);
    });
  } catch { return undefined; } // IndexedDB non disponibile (navigazione privata): l'app funziona comunque
}

export const metaLeggi = (k) => tx('progetto', 'readonly', (s) => s.get(k));
export const metaSalva = (k, v) => tx('progetto', 'readwrite', (s) => s.put(v, k));
export const metaElimina = (k) => tx('progetto', 'readwrite', (s) => s.delete(k));

export const progettiTutti = async () => (await tx('progetti', 'readonly', (s) => s.getAll())) || [];
export const progettoLeggi = (id) => tx('progetti', 'readonly', (s) => s.get(id));
export const progettoSalva = (rec) => tx('progetti', 'readwrite', (s) => s.put(rec, rec.id));
export const progettoElimina = (id) => tx('progetti', 'readwrite', (s) => s.delete(id));

export const audioSalva = (id, blob) => tx('audio', 'readwrite', (s) => s.put(blob, id));
export const audioLeggi = (id) => tx('audio', 'readonly', (s) => s.get(id));
export const audioElimina = (id) => tx('audio', 'readwrite', (s) => s.delete(id));
export const audioChiavi = async () => (await tx('audio', 'readonly', (s) => s.getAllKeys())) || [];

export const tuttoSvuota = async () => { for (const n of ['progetto', 'audio', 'progetti']) await tx(n, 'readwrite', (s) => s.clear()); };
