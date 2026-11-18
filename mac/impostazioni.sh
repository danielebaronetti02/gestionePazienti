# Impostazioni del server Gestione Pazienti su Mac (lette da gestione.sh e avvia-server.sh).
# Dopo una modifica eseguite riavvia.command.

# Porta su cui risponde il server: http://localhost:8000
PAZIENTI_PORTA=8000

# 127.0.0.1 = solo da questo Mac (consigliato)
# 0.0.0.0   = anche dagli altri PC della rete: SOLO dopo aver messo HTTPS davanti (vedi README)
PAZIENTI_HOST=127.0.0.1

# Altre impostazioni facoltative (togliete "#" davanti per attivarle):
# export PAZIENTI_SESSION_MINUTES=5
# export PAZIENTI_TEMP_PASSWORD_HOURS=72
# export PAZIENTI_DATA_DIR="$HOME/GestionePazienti-dati"
