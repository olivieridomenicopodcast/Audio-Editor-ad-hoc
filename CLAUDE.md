# Istruzioni per Claude Code – Audio Editor ad hoc

Rispondi in italiano. Proprietario: Niky (Domenico Olivieri).

- Git: Niky vuole che commit e push su `main` li faccia sempre Claude in autonomia, senza chiedere conferma. Non aprire pull request se non richiesto.
- Stessa identità visiva di DomePodcast Studio: colori e font **solo** da `assets/brand.css` (viola `#2E1976`, arancione `#EE8F4D`, giallo-arancio `#F4B162`, lilla `#A98BEE`; Staatliches per i titoli, Libre Baskerville per i testi). Nessun @import da internet.
- Tono dei testi: diretto e caldo, dai del tu.

## Cos'è
PWA (si pubblica con GitHub Pages da `main`, cartella root) per **montare l'audio dal telefono** quando Niky è in giro: taglio, magnete (ripple + snap), crossfade, fade, marcatori, accorcia-pause, export WAV. Il lavoro vero (sonorizzazione, mix) lo fa poi su Pro Tools: l'app serve solo a risparmiare tempo sul montaggio. Non aggiungere effetti, mix o registrazione se Niky non li chiede.

## Struttura
- `index.html`, `app/app.css`, `sw.js`, `manifest.webmanifest`, `icons/`: la PWA.
- `app/modello.js`: logica di montaggio **pura** (clip, taglio, ripple, crossfade, fade, pause, annulla/ripristina). Nessun DOM, nessun audio: si prova in Node con `node scripts/prova-modello.mjs`.
- `app/audio.js`: Web Audio (decodifica, picchi, riproduzione, rendering offline, codifica WAV).
- `app/app.js`: timeline su canvas, gesti (pointer events), finestre, import/export.
- `app/idb.js`: progetto e file audio salvati sul telefono (IndexedDB). `app/zip.js`: zip senza compressione.
- `app/build.js`: numero di build (generato).

## Come funziona il montaggio
- Montaggio **non distruttivo**: una clip è un riferimento a un file (`src`, `off`, `dur`), l'audio originale non si tocca.
- Il **playhead è fisso al centro**, scorre la timeline (come BandLab). Taglio = porti il playhead nel punto e premi «Taglia».
- **Magnete** acceso: «Elimina» e il trim dei bordi chiudono il buco (le clip dopo scorrono a sinistra); spostando una clip o un bordo si aggancia a bordi di altre clip e playhead. Spento: tutto resta dov'è.
- **Fade**: angoli in alto della clip selezionata (sinistro = fade in, destro = fade out). Curva a potenza costante (seno/coseno).
- **Crossfade**: la clip selezionata si sovrappone alla precedente di N ms.
- Su ogni taglio non continuo c'è un micro-declick di 3 ms (`DECLICK`) contro i click.
- Export: WAV unico (OfflineAudioContext) oppure zip di clip separate + `posizioni.txt` (per ricomporle in Pro Tools).

## Numero di build
**Prima di OGNI commit** esegui: `sh scripts/aggiorna-build.sh && git add app/build.js`. Per l'app «build N» = numero di commit.

## Service worker (`sw.js`)
Stale-while-revalidate. Ogni file nuovo usato dall'app va aggiunto alla lista `FILE`.

## Verifiche prima di consegnare
`node scripts/prova-modello.mjs` e una prova con Playwright (viewport da telefono, nessun errore in console; importa due WAV, taglia, elimina, crossfade, esporta).
