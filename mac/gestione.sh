#!/bin/bash
# Gestione Pazienti - installazione e controllo del server su macOS.
#   gestione.sh installa | attiva-avvio-automatico | disattiva-avvio-automatico | avvia | ferma | riavvia | stato
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
DATI="${PAZIENTI_DATA_DIR:-$BACKEND/data}"
LOG="$DATI/server.log"
PIDFILE="$DATI/server.pid"
URL="http://localhost:$PORTA"

verde() { printf '  \033[32mOK\033[0m  %s\n' "$1"; }
rosso() { printf '  \033[31m!!\033[0m  %s\n' "$1"; }
giallo() { printf '  \033[33m--\033[0m  %s\n' "$1"; }

risponde() { curl -fsS -m 3 "$URL/api/public-config" >/dev/null 2>&1; }
pid_porta() { lsof -nP -t -iTCP:"$PORTA" -sTCP:LISTEN 2>/dev/null; }
caricato() { launchctl print "$DOMINIO/$ETICHETTA" >/dev/null 2>&1; }
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

trova_python() {
  for c in python3.13 python3.12 python3.11 python3.14 python3.10 python3; do
    command -v "$c" >/dev/null 2>&1 || continue
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then echo "$c"; return 0; fi
  done
  return 1
}

installa() {
  echo "== Installazione di Gestione Pazienti in $PROGETTO =="
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
  "$PY_VENV" -m pip install -r requirements.txt --quiet --disable-pip-version-check || { rosso "pip install non riuscito."; exit 1; }
  "$PY_VENV" -c "import fastapi, pydantic_core, uvicorn" || { rosso "Le librerie Python non si caricano (vedi errore sopra)."; exit 1; }
  verde "Backend pronto"

  if command -v npm >/dev/null 2>&1; then
    local copia; copia="$(mktemp -d)"
    [ -f "$FRONTEND/dist/index.html" ] && cp -R "$FRONTEND/dist" "$copia/dist"
    echo "Compilo il frontend (npm install + npm run build)..."
    if (cd "$FRONTEND" && npm install --no-audit --no-fund && npm run build) && [ -f "$FRONTEND/dist/index.html" ]; then
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
  if attendi; then verde "Server acceso: $URL"; else rosso "Il server non risponde. Ultime righe del log:"; tail -n 20 "$LOG" 2>/dev/null; exit 1; fi
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
    verde "Server acceso: $URL"
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
  echo "== Gestione Pazienti =="
  if risponde; then verde "Server ACCESO: $URL"; else rosso "Server SPENTO (porta $PORTA)"; fi
  if [ -f "$PLIST" ]; then verde "Avvio automatico ATTIVO ($PLIST)"; else giallo "Avvio automatico NON attivo (attivalo con attiva-avvio-automatico.command)"; fi
  [ -f "$LOG" ] && { echo "Ultime righe del log ($LOG):"; tail -n 8 "$LOG" | sed 's/^/      /'; }
}

case "$AZIONE" in
  installa) installa ;;
  attiva-avvio-automatico) attiva ;;
  disattiva-avvio-automatico) disattiva ;;
  avvia) avvia ;;
  ferma) ferma ;;
  riavvia) ferma >/dev/null; avvia ;;
  stato) stato ;;
  *) echo "Uso: $0 installa|attiva-avvio-automatico|disattiva-avvio-automatico|avvia|ferma|riavvia|stato"; exit 2 ;;
esac
