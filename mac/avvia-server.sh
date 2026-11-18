#!/bin/bash
# Avvia il server in primo piano. Lo usa launchd (avvio automatico); potete lanciarlo anche a mano (Ctrl+C per fermarlo).
CARTELLA="$(cd "$(dirname "$0")" && pwd)"
source "$CARTELLA/impostazioni.sh"
export PYTHONUNBUFFERED=1 PYTHONUTF8=1
cd "$CARTELLA/../backend" || exit 1
if [ ! -x .venv/bin/python ]; then echo "Ambiente Python non trovato: eseguite prima mac/installa.command"; exit 1; fi
echo "[$(date '+%F %T')] avvio su $PAZIENTI_HOST:$PAZIENTI_PORTA"
exec .venv/bin/python -m app --host "$PAZIENTI_HOST" --port "$PAZIENTI_PORTA"
