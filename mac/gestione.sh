#!/bin/bash
# Gestione Pazienti - installazione e controllo del server su macOS.
#   gestione.sh installa | attiva-avvio-automatico | disattiva-avvio-automatico | avvia | ferma | riavvia | stato | aggiorna
# (oppure doppio clic sui file .command della stessa cartella)

AZIONE="${1:-stato}"
CARTELLA="$(cd "$(dirname "$0")" && pwd)"
PROGETTO="$(cd "$CARTELLA/.." && pwd)"
BACKEND="$PROGETTO/backend"
FRONTEND="$PROGETTO/frontend"
PY_VENV="$BACKEND/.venv/bin/python"
ETICHETTA="local.gestione-pazienti"
PLIST="$HOME/Library/LaunchAgents/$ETICHETTA.plist"
DOMINIO="gui/$(id -u)"
source "$CARTELLA/impostazioni.sh"
PORTA="${PAZIENTI_PORTA:-8000}"
DATI="$PAZIENTI_DATA_DIR"
VECCHI_DATI="$BACKEND/data"            # posizione dei dati fino alla versione 3.0
LOCALI="$CARTELLA/impostazioni-locali.sh"
LOG="$DATI/server.log"
PIDFILE="$DATI/server.pid"
URL="http://localhost:$PORTA"

verde() { printf '  \033[32mOK\033[0m  %s\n' "$1"; }
rosso() { printf '  \033[31m!!\033[0m  %s\n' "$1"; }
giallo() { printf '  \033[33m--\033[0m  %s\n' "$1"; }

risponde() { curl -fsS -m 3 "$URL/api/public-config" >/dev/null 2>&1; }
pid_porta() { lsof -nP -t -iTCP:"$PORTA" -sTCP:LISTEN 2>/dev/null; }
caricato() { launchctl print "$DOMINIO/$ETICHETTA" >/dev/null 2>&1; }
mostra_password_iniziale() {
  local f="$DATI/PASSWORD-INIZIALE-ADMIN.txt"
  if [ -f "$f" ]; then
    echo; echo "  Primo accesso dell'amministratore (il file si cancella da solo dopo il cambio password):"
    grep -E '^(Email|Password):' "$f" | sed 's/^/      /'; echo "      (file: $f)"
  fi
}
attendi() { for _ in $(seq 1 40); do risponde && return 0; sleep 1; done; return 1; }

controlla_cartella() {
  # launchd non puo' leggere Scrivania, Documenti e Download senza permessi speciali di macOS
  case "$PROGETTO" in
    "$HOME/Desktop"*|"$HOME/Documents"*|"$HOME/Downloads"*)
      rosso "Il progetto e' in $PROGETTO."
      echo "      macOS non permette ai servizi automatici di leggere Scrivania, Documenti e Download."
      echo "      Sposta la cartella nella tua cartella Inizio (es. $HOME/gestione-pazienti-web) e rilancia."
      return 1 ;;
  esac
  return 0
}

versione() { sed -n 's/^APP_VERSION *= *"\(.*\)"/\1/p' "$BACKEND/app/version.py" 2>/dev/null || echo "?"; }

prepara_impostazioni_locali() {
  [ -f "$LOCALI" ] && return 0
  cat > "$LOCALI" <<IMP
# Impostazioni di QUESTO Mac (gli aggiornamenti non toccano questo file). Dopo una modifica: riavvia.command
# Cartella dei dati (database, backup, log): fuori dalla cartella del programma.
export PAZIENTI_DATA_DIR="$DATI"
# Per scaricare gli aggiornamenti da un repository GitHub privato serve un token di sola lettura:
# PAZIENTI_GITHUB_TOKEN=github_pat_...
IMP
  verde "Creato mac/impostazioni-locali.sh (dati in $DATI)"
}

trova_python() {
  for c in python3.13 python3.12 python3.11 python3.14 python3.10 python3; do
    command -v "$c" >/dev/null 2>&1 || continue
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then echo "$c"; return 0; fi
  done
  return 1
}

installa() {
  echo "== Installazione di Gestione Pazienti $(versione) in $PROGETTO =="
  prepara_impostazioni_locali
  PY="$(trova_python)" || { rosso "Python 3.10+ non trovato. Installa Python 3.13 da https://www.python.org/downloads/macos/ e riprova."; exit 1; }
  verde "Python: $($PY --version)"
  local acceso=0; risponde && acceso=1 && { echo "Il server e' acceso: lo fermo per aggiornarlo..."; ferma >/dev/null; }
  cd "$BACKEND" || exit 1
  if [ -x "$PY_VENV" ] && [ "$("$PY_VENV" -c 'import sys;print(sys.version.split()[0])')" != "$("$PY" -c 'import sys;print(sys.version.split()[0])')" ]; then
    echo "Ricreo l'ambiente Python con $($PY --version)..."; rm -rf .venv
  fi
  [ -x "$PY_VENV" ] || { echo "Creo l'ambiente Python (backend/.venv)..."; "$PY" -m venv .venv || { rosso "Creazione dell'ambiente non riuscita."; exit 1; }; }
  echo "Installo le librerie Python..."
  "$PY_VENV" -m pip install --upgrade pip --quiet --disable-pip-version-check
  if [ -f requirements.lock.txt ]; then
    echo "  (versioni fissate da requirements.lock.txt)"
    "$PY_VENV" -m pip install -r requirements.lock.txt --quiet --disable-pip-version-check || { rosso "pip install non riuscito."; exit 1; }
  else
    "$PY_VENV" -m pip install -r requirements.txt --quiet --disable-pip-version-check || { rosso "pip install non riuscito."; exit 1; }
    "$PY_VENV" -m pip freeze --exclude pip --exclude setuptools > requirements.lock.txt
    verde "Versioni delle librerie salvate in backend/requirements.lock.txt (da salvare anche su git)"
  fi
  "$PY_VENV" -c "import fastapi, pydantic_core, uvicorn" || { rosso "Le librerie Python non si caricano (vedi errore sopra)."; exit 1; }
  verde "Backend pronto"

  if command -v npm >/dev/null 2>&1; then
    local copia; copia="$(mktemp -d)"
    [ -f "$FRONTEND/dist/index.html" ] && cp -R "$FRONTEND/dist" "$copia/dist"
    echo "Compilo il frontend (npm install + npm run build)..."
    if (cd "$FRONTEND" && { { [ -f package-lock.json ] && npm ci --no-audit --no-fund; } || npm install --no-audit --no-fund; } && npm run build) && [ -f "$FRONTEND/dist/index.html" ]; then
      verde "Frontend compilato in frontend/dist"
    elif [ -f "$copia/dist/index.html" ]; then
      rm -rf "$FRONTEND/dist"; cp -R "$copia/dist" "$FRONTEND/dist"
      giallo "Compilazione non riuscita: uso il frontend gia' compilato incluso nel progetto."
    else
      rosso "Compilazione del frontend non riuscita."; exit 1
    fi
    rm -rf "$copia"
  elif [ -f "$FRONTEND/dist/index.html" ]; then
    giallo "Node.js non trovato: uso il frontend gia' compilato incluso nel progetto."
  else
    rosso "Node.js non trovato e frontend/dist mancante: installa Node.js LTS da https://nodejs.org/"; exit 1
  fi
  chmod +x "$CARTELLA"/*.sh "$CARTELLA"/*.command 2>/dev/null
  [ $acceso = 1 ] && avvia >/dev/null
  echo; verde "Installazione completata."
  echo "Prossimo passo: doppio clic su mac/attiva-avvio-automatico.command, oppure mac/avvia.command. Poi apri $URL"
}

scrivi_plist() {
  mkdir -p "$HOME/Library/LaunchAgents" "$DATI"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$ETICHETTA</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$CARTELLA/avvia-server.sh</string></array>
  <key>WorkingDirectory</key><string>$BACKEND</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
}

attiva() {
  [ -x "$PY_VENV" ] || { rosso "Prima esegui installa.command."; exit 1; }
  controlla_cartella || exit 1
  ferma >/dev/null
  scrivi_plist
  launchctl bootstrap "$DOMINIO" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
  verde "Avvio automatico attivato: il server partira' a ogni accensione del Mac (al login dell'utente $(whoami))."
  if attendi; then verde "Server acceso: $URL"; mostra_password_iniziale; else rosso "Il server non risponde. Ultime righe del log:"; tail -n 20 "$LOG" 2>/dev/null; exit 1; fi
}

disattiva() {
  if [ -f "$PLIST" ]; then
    ferma >/dev/null; rm -f "$PLIST"
    verde "Avvio automatico disattivato e server spento. Per riaccenderlo a mano: avvia.command"
  else
    echo "L'avvio automatico non era attivo."
  fi
}

avvia() {
  [ -x "$PY_VENV" ] || { rosso "Prima esegui installa.command."; exit 1; }
  if risponde; then verde "Il server e' gia' acceso: $URL"; return 0; fi
  [ -n "$(pid_porta)" ] && { rosso "La porta $PORTA e' occupata da un altro programma: cambiala in mac/impostazioni.sh."; exit 1; }
  mkdir -p "$DATI"
  if [ -f "$PLIST" ]; then
    controlla_cartella || exit 1
    caricato && launchctl kickstart -k "$DOMINIO/$ETICHETTA" || launchctl bootstrap "$DOMINIO" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
  else
    # rotazione semplice del log
    [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 5000000 ] && mv -f "$LOG" "$DATI/server.old.log"
    nohup /bin/bash "$CARTELLA/avvia-server.sh" >> "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
  fi
  echo "Avvio in corso..."
  if attendi; then
    verde "Server acceso: $URL"; mostra_password_iniziale
    [ -f "$PLIST" ] || giallo "Avvio manuale: dopo uno spegnimento del Mac non ripartira'. Per l'avvio automatico: attiva-avvio-automatico.command"
  else
    rosso "Il server non risponde. Ultime righe del log ($LOG):"; tail -n 25 "$LOG" 2>/dev/null; exit 1
  fi
}

ferma() {
  if caricato; then launchctl bootout "$DOMINIO/$ETICHETTA" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null; fi
  [ -f "$PIDFILE" ] && { kill "$(cat "$PIDFILE")" 2>/dev/null; rm -f "$PIDFILE"; }
  local p; p="$(pid_porta)"; [ -n "$p" ] && kill $p 2>/dev/null
  for _ in $(seq 1 10); do [ -z "$(pid_porta)" ] && break; sleep 0.5; done
  [ -n "$(pid_porta)" ] && kill -9 $(pid_porta) 2>/dev/null
  verde "Server spento."
  [ -f "$PLIST" ] && echo "      L'avvio automatico resta attivo: alla prossima accensione del Mac il server ripartira'."
  return 0
}

stato() {
  echo "== Gestione Pazienti $(versione) =="
  echo "   Dati: $DATI"
  if risponde; then verde "Server ACCESO: $URL"; else rosso "Server SPENTO (porta $PORTA)"; fi
  mostra_password_iniziale
  if [ -f "$PLIST" ]; then verde "Avvio automatico ATTIVO ($PLIST)"; else giallo "Avvio automatico NON attivo (attivalo con attiva-avvio-automatico.command)"; fi
  [ -f "$LOG" ] && { echo "Ultime righe del log ($LOG):"; tail -n 8 "$LOG" | sed 's/^/      /'; }
}

backup_database() {
  for dir in "$DATI" "$VECCHI_DATI"; do
    [ -f "$dir/pazienti.db" ] || continue
    mkdir -p "$dir/backup"
    local nome="pazienti-$(date +%Y%m%d-%H%M%S)-$1.db"
    cp "$dir/pazienti.db" "$dir/backup/$nome"
    for ext in -wal -shm; do [ -f "$dir/pazienti.db$ext" ] && cp "$dir/pazienti.db$ext" "$dir/backup/$nome$ext"; done
    verde "Backup del database: $dir/backup/$nome"
  done
}

scarica_codice() {
  if [ -d "$PROGETTO/.git" ] && command -v git >/dev/null 2>&1; then
    echo "Scarico l'ultima versione con git..."
    git -C "$PROGETTO" pull --ff-only || { rosso "git pull non riuscito: se hai modificato dei file, controlla con  git -C \"$PROGETTO\" status"; return 1; }
    return 0
  fi
  [ -n "$PAZIENTI_REPO" ] || { rosso "Repository non impostato (PAZIENTI_REPO in mac/impostazioni.sh)."; return 1; }
  local tmp; tmp="$(mktemp -d)"
  local auth=(); [ -n "$PAZIENTI_GITHUB_TOKEN" ] && auth=(-H "Authorization: Bearer $PAZIENTI_GITHUB_TOKEN")
  echo "Scarico l'ultima versione da GitHub ($PAZIENTI_REPO)..."
  if ! curl -fsSL "${auth[@]}" -H "Accept: application/vnd.github+json" -o "$tmp/versione.zip" \
       "https://api.github.com/repos/$PAZIENTI_REPO/zipball/${PAZIENTI_RAMO:-main}"; then
    rosso "Download non riuscito. Se il repository è privato serve PAZIENTI_GITHUB_TOKEN in mac/impostazioni-locali.sh (vedi README)."
    rm -rf "$tmp"; return 1
  fi
  unzip -q "$tmp/versione.zip" -d "$tmp/x" || { rosso "Il file scaricato è danneggiato."; rm -rf "$tmp"; return 1; }
  local src; src="$(find "$tmp/x" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [ -f "$src/backend/app/version.py" ] || { rosso "Il file scaricato non sembra Gestione Pazienti."; rm -rf "$tmp"; return 1; }
  # copia il programma; NON tocca: dati, ambiente Python, librerie npm, impostazioni locali
  if ! tar -C "$src" --exclude './backend/data' --exclude './backend/.venv' --exclude './frontend/node_modules' \
           --exclude './frontend/dist' --exclude '*/impostazioni-locali.sh' --exclude '*/impostazioni-locali.cmd' -cf - . \
       | tar -C "$PROGETTO" -xf -; then
    rosso "Copia dei file non riuscita."; rm -rf "$tmp"; return 1
  fi
  # frontend compilato: sostituito per intero (i nomi dei file cambiano a ogni versione)
  rm -rf "$FRONTEND/dist" && cp -R "$src/frontend/dist" "$FRONTEND/dist" || { rosso "Copia del frontend non riuscita."; rm -rf "$tmp"; return 1; }
  xattr -dr com.apple.quarantine "$PROGETTO" 2>/dev/null
  chmod +x "$CARTELLA"/*.sh "$CARTELLA"/*.command 2>/dev/null
  rm -rf "$tmp"
}

aggiorna() {
  local prima; prima="$(versione)"
  echo "== Aggiornamento di Gestione Pazienti (versione attuale $prima) =="
  echo "   I dati restano in $DATI e non vengono toccati."
  local acceso=0; risponde && acceso=1
  [ $acceso = 1 ] || [ -n "$(pid_porta)" ] && { echo "Fermo il server..."; ferma >/dev/null; }
  backup_database "pre-aggiornamento"
  if ! scarica_codice; then [ $acceso = 1 ] && avvia >/dev/null; exit 1; fi
  local dopo; dopo="$(versione)"
  [ "$dopo" = "$prima" ] && verde "Già all'ultima versione ($dopo): reinstallo comunque le librerie." || verde "Scaricata la versione $dopo."
  # installazione e avvio con lo script NUOVO (potrebbe essere cambiato)
  /bin/bash "$CARTELLA/gestione.sh" installa || { rosso "Installazione non completata: il database è intatto, vedi i messaggi sopra."; exit 1; }
  if [ $acceso = 1 ] || [ -f "$PLIST" ]; then /bin/bash "$CARTELLA/gestione.sh" avvia; fi
  echo; verde "Aggiornamento completato: $prima -> $dopo. Il database viene adattato alla nuova versione all'avvio (con backup automatico)."
}

case "$AZIONE" in
  installa) installa ;;
  attiva-avvio-automatico) attiva ;;
  disattiva-avvio-automatico) disattiva ;;
  avvia) avvia ;;
  ferma) ferma ;;
  riavvia) ferma >/dev/null; avvia ;;
  stato) stato ;;
  aggiorna) aggiorna ;;
  *) echo "Uso: $0 installa|attiva-avvio-automatico|disattiva-avvio-automatico|avvia|ferma|riavvia|stato|aggiorna"; exit 2 ;;
esac
