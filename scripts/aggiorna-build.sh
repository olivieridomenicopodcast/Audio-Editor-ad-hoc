#!/bin/sh
# Scrive in app/build.js il numero di build = numero di commit (compreso quello che stai per fare).
# Va eseguito PRIMA di ogni commit:  sh scripts/aggiorna-build.sh && git add app/build.js
cd "$(git rev-parse --show-toplevel)" || exit 1
n=$(( $(git rev-list --count HEAD 2>/dev/null || echo 0) + 1 ))
printf "// Generato da scripts/aggiorna-build.sh: numero di commit (build) mostrato in fondo all'app.\nexport const BUILD = %s;\n" "$n" > app/build.js
echo "build $n"
