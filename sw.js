// Service worker: l'app funziona offline e si aggiorna da sola.
// Strategia "stale-while-revalidate": risponde subito dalla cache e intanto scarica la versione nuova.
// Se aggiungi file nuovi usati dall'app, aggiungili alla lista FILE.
const CACHE = 'audio-editor-ad-hoc-v1';
const FILE = [
  './', 'index.html', 'manifest.webmanifest',
  'app/app.css', 'app/app.js', 'app/modello.js', 'app/audio.js', 'app/idb.js', 'app/zip.js', 'app/build.js',
  'assets/brand.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'fonts/Staatliches-Regular.ttf', 'fonts/LibreBaskerville-var.ttf',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.searchParams.has('check')) return; // controllo aggiornamenti: sempre dalla rete
  ev.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const rete = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || rete;
    }),
  );
});
