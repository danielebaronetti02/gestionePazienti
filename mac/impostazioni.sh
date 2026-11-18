# Impostazioni PREDEFINITE del server Gestione Pazienti su Mac (fanno parte del programma:
# gli aggiornamenti possono sostituire questo file).
# Le impostazioni di QUESTO Mac vanno in impostazioni-locali.sh, creato da installa.command,
# che gli aggiornamenti non toccano e che prevale su questo file.

# Porta su cui risponde il server: http://localhost:8000
PAZIENTI_PORTA=8000

# 127.0.0.1 = solo da questo Mac (consigliato)
# 0.0.0.0   = anche dagli altri PC della rete: SOLO dopo aver messo HTTPS davanti (vedi README)
PAZIENTI_HOST=127.0.0.1

# Da dove aggiorna.command scarica le nuove versioni (repository GitHub e ramo)
PAZIENTI_REPO=danielebaronetti02/gestionePazienti
PAZIENTI_RAMO=main

# Cartella dei dati: se non indicata, ~/GestionePazienti-dati (fuori dal programma)
# Altre impostazioni facoltative (da mettere in impostazioni-locali.sh):
# export PAZIENTI_SESSION_MINUTES=5
# export PAZIENTI_TEMP_PASSWORD_HOURS=72
# export PAZIENTI_TESSERACT=/opt/homebrew/bin/tesseract

_locali="$(dirname "${BASH_SOURCE[0]}")/impostazioni-locali.sh"
[ -f "$_locali" ] && source "$_locali"
export PAZIENTI_DATA_DIR="${PAZIENTI_DATA_DIR:-$HOME/GestionePazienti-dati}"
