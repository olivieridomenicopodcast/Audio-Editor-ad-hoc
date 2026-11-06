# Audio Editor ad hoc

Editor audio essenziale per il telefono (PWA), pensato per montare al volo e poi rifinire su Pro Tools.

**Funzioni:** taglio sul playhead · magnete (ripple + snap, come Shuffle/Slip) · fade con gli angoli della clip · crossfade · marcatori · accorcia le pause lunghe · annulla/ripristina · più progetti aperti a piacere · sincronizzazione dei progetti su GitHub (Push/Pull) · export WAV (16/24/32 bit) o clip separate in zip.

Si apre da: https://olivieridomenicopodcast.github.io/Audio-Editor-ad-hoc/ (GitHub Pages da `main`).

Prova della logica: `node scripts/prova-modello.mjs`.

L'audio esce **identico** a come entra (WAV letti e scritti campione per campione, nessun effetto né ricampionamento): verificato con `node scripts/prova-neutro.cjs`.
