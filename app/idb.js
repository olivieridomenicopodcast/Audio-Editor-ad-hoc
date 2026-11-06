// idb.js - salva il progetto e i file audio sul telefono (IndexedDB), così al riavvio ritrovi il montaggio.
const NOME = 'audio-editor-ad-hoc';
let dbp;

function db() {
  if (!dbp) {
    dbp = new Promise((ok, ko) => {
      const r = indexedDB.open(NOME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('progetto'); r.result.createObjectStore('audio'); };
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

export const progettoSalva = (dati) => tx('progetto', 'readwrite', (s) => s.put(dati, 'corrente'));
export const progettoLeggi = () => tx('progetto', 'readonly', (s) => s.get('corrente'));
export const audioSalva = (id, blob) => tx('audio', 'readwrite', (s) => s.put(blob, id));
export const audioLeggi = (id) => tx('audio', 'readonly', (s) => s.get(id));
export const tuttoSvuota = async () => { await tx('progetto', 'readwrite', (s) => s.clear()); await tx('audio', 'readwrite', (s) => s.clear()); };
