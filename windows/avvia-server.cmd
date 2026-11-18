@echo off
rem Avvia il server e lo tiene acceso: se si chiude per un errore riparte dopo 5 secondi.
rem Lo usa l'attivita' pianificata "GestionePazienti"; potete lanciarlo anche a mano
rem (si ferma chiudendo la finestra, oppure con ferma.cmd).
setlocal
call "%~dp0impostazioni.cmd"
set PYTHONUTF8=1
set PYTHONUNBUFFERED=1
cd /d "%~dp0..\backend"
if not exist ".venv\Scripts\python.exe" (
  echo Ambiente Python non trovato: eseguite prima windows\installa.cmd
  exit /b 1
)
if not defined PAZIENTI_DATA_DIR set "PAZIENTI_DATA_DIR=%USERPROFILE%\GestionePazienti-dati"
set "DATI=%PAZIENTI_DATA_DIR%"
if not exist "%DATI%" mkdir "%DATI%"
rem all'accensione del PC (o con avvia.cmd) un eventuale "fermato" precedente non conta piu'
if exist "%DATI%\fermato.flag" del /q "%DATI%\fermato.flag"

:ciclo
rem log a rotazione semplice: oltre 5 MB il vecchio diventa server.old.log
if exist "%DATI%\server.log" for %%F in ("%DATI%\server.log") do if %%~zF GTR 5000000 move /y "%DATI%\server.log" "%DATI%\server.old.log" >nul
echo [%date% %time%] avvio su %PAZIENTI_HOST%:%PAZIENTI_PORTA% >> "%DATI%\server.log"
".venv\Scripts\python.exe" -m app --host %PAZIENTI_HOST% --port %PAZIENTI_PORTA% >> "%DATI%\server.log" 2>&1
rem fermato con ferma.cmd: non ripartire
if exist "%DATI%\fermato.flag" exit /b 0
echo [%date% %time%] il server si e' chiuso: riavvio tra 5 secondi >> "%DATI%\server.log"
ping -n 6 127.0.0.1 >nul
goto ciclo
