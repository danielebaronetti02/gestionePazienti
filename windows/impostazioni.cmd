@rem Impostazioni PREDEFINITE del server Gestione Pazienti (fanno parte del programma:
@rem gli aggiornamenti possono sostituire questo file).
@rem Le impostazioni di QUESTO PC vanno in impostazioni-locali.cmd, creato da installa.cmd,
@rem che gli aggiornamenti non toccano e che prevale su questo file.

@rem Porta su cui risponde il server: http://localhost:8000
set PAZIENTI_PORTA=8000

@rem 127.0.0.1 = solo da questo PC (consigliato)
@rem 0.0.0.0   = anche dagli altri PC della rete: SOLO dopo aver messo HTTPS davanti (vedi README)
set PAZIENTI_HOST=127.0.0.1

@rem Da dove aggiorna.cmd scarica le nuove versioni (repository GitHub e ramo)
set PAZIENTI_REPO=danielebaronetti02/gestionePazienti
set PAZIENTI_RAMO=main

@rem Cartella dei dati: se non indicata, %USERPROFILE%\GestionePazienti-dati (fuori dal programma)
@rem Altre impostazioni facoltative (da mettere in impostazioni-locali.cmd):
@rem set PAZIENTI_SESSION_MINUTES=5
@rem set PAZIENTI_TEMP_PASSWORD_HOURS=72
@rem set PAZIENTI_TESSERACT=C:\Program Files\Tesseract-OCR\tesseract.exe

if exist "%~dp0impostazioni-locali.cmd" call "%~dp0impostazioni-locali.cmd"
