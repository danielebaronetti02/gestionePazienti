@rem Impostazioni del server Gestione Pazienti (lette da avvia-server.cmd e da gestione.ps1).
@rem Dopo una modifica eseguite riavvia.cmd.

@rem Porta su cui risponde il server: http://localhost:8000
set PAZIENTI_PORTA=8000

@rem 127.0.0.1 = solo da questo PC (consigliato)
@rem 0.0.0.0   = anche dagli altri PC della rete: SOLO dopo aver messo HTTPS davanti (vedi README)
set PAZIENTI_HOST=127.0.0.1

@rem Altre impostazioni facoltative (togliete "@rem" davanti per attivarle):
@rem set PAZIENTI_SESSION_MINUTES=5
@rem set PAZIENTI_TEMP_PASSWORD_HOURS=72
@rem Cartella dei dati FUORI da Desktop/OneDrive (consigliato, vedi README):
@rem set PAZIENTI_DATA_DIR=C:\GestionePazienti\dati
