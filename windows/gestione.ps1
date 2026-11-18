<#
  Gestione Pazienti - installazione e controllo del server su Windows.

  Uso (oppure doppio clic sui file .cmd della stessa cartella):
    gestione.ps1 installa                     prima installazione (Python + Node.js gia' installati)
    gestione.ps1 attiva-avvio-automatico      il server parte da solo all'accensione del PC (chiede i permessi di amministratore)
    gestione.ps1 disattiva-avvio-automatico   toglie l'avvio automatico
    gestione.ps1 avvia | ferma | riavvia      controllo manuale del server
    gestione.ps1 stato                        il server e' acceso? l'avvio automatico e' attivo?
    gestione.ps1 aggiorna                     scarica l'ultima versione e la installa SENZA toccare i dati
    gestione.ps1 apri-firewall                apre la porta nel firewall di Windows (per gli altri PC; serve HTTPS, vedi README)
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet("installa", "attiva-avvio-automatico", "disattiva-avvio-automatico", "avvia", "ferma", "riavvia", "stato", "apri-firewall", "aggiorna")]
  [string]$Azione = "stato",
  [string]$Utente = "",
  [switch]$Pausa
)

$ErrorActionPreference = "Stop"
$NomeAttivita = "GestionePazienti"
$Cartella     = Split-Path -Parent $PSCommandPath
$Progetto     = Split-Path -Parent $Cartella
$Backend      = Join-Path $Progetto "backend"
$Frontend     = Join-Path $Progetto "frontend"
$PythonVenv   = Join-Path $Backend ".venv\Scripts\python.exe"
$AvviaServer  = Join-Path $Cartella "avvia-server.cmd"
$Locali       = Join-Path $Cartella "impostazioni-locali.cmd"
$VecchiDati   = Join-Path $Backend "data"       # posizione dei dati fino alla versione 3.0

# --- impostazioni: impostazioni.cmd (del programma) poi impostazioni-locali.cmd (di questo PC, prevale) ---
$Imp = @{ PAZIENTI_PORTA = "8000"; PAZIENTI_DATA_DIR = (Join-Path $env:USERPROFILE "GestionePazienti-dati");
          PAZIENTI_REPO = ""; PAZIENTI_RAMO = "main"; PAZIENTI_GITHUB_TOKEN = "" }
foreach ($file in @((Join-Path $Cartella "impostazioni.cmd"), $Locali)) {
  if (-not (Test-Path $file)) { continue }
  foreach ($r in (Get-Content $file)) {
    if ($r -match '^\s*set\s+"?(PAZIENTI_[A-Z_]+)=([^"]*)"?\s*$') { $Imp[$Matches[1]] = $Matches[2].Trim() }
  }
}
$Porta       = [int]$Imp.PAZIENTI_PORTA
$DatiDir     = [Environment]::ExpandEnvironmentVariables($Imp.PAZIENTI_DATA_DIR)
$FlagFermato = Join-Path $DatiDir "fermato.flag"
$Log         = Join-Path $DatiDir "server.log"
$env:PAZIENTI_DATA_DIR = $DatiDir
$Url = "http://localhost:$Porta"

function Scrivi([string]$testo, [string]$colore = "Gray") { Write-Host $testo -ForegroundColor $colore }
function Ok([string]$testo)     { Write-Host "  OK  $testo" -ForegroundColor Green }
function Errore([string]$testo) { Write-Host "  !!  $testo" -ForegroundColor Red }

function Fine([int]$codice = 0) {
  if ($Pausa) { Write-Host ""; Read-Host "Premi Invio per chiudere" | Out-Null }
  exit $codice
}

function E-Amministratore {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Rilancia lo script con i permessi di amministratore (compare la richiesta di Windows).
function Richiedi-Amministratore {
  if (E-Amministratore) { return }
  $utenteCorrente = if ($Utente) { $Utente } else { "$env:USERDOMAIN\$env:USERNAME" }
  Scrivi "Servono i permessi di amministratore: conferma la richiesta di Windows..." Yellow
  $argomenti = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" $Azione -Utente `"$utenteCorrente`" -Pausa"
  try { Start-Process powershell.exe -Verb RunAs -ArgumentList $argomenti | Out-Null }
  catch { Errore "Permessi di amministratore negati."; exit 1 }
  exit 0
}

function Versione {
  $f = Join-Path $Backend "app\version.py"
  if ((Test-Path $f) -and ((Get-Content $f -Raw) -match 'APP_VERSION\s*=\s*"([^"]+)"')) { return $Matches[1] }
  return "?"
}

# Impostazioni di questo PC: create alla prima installazione, mai sovrascritte dagli aggiornamenti
function Prepara-ImpostazioniLocali {
  if (Test-Path $Locali) { return }
  # percorso scritto per esteso; con lettere accentate nel nome utente si lascia %USERPROFILE% (cmd non le legge bene)
  $dati = if ($DatiDir -match '^[\x20-\x7E]+$') { $DatiDir } else { "%USERPROFILE%\GestionePazienti-dati" }
  $testo = @(
    "@rem Impostazioni di QUESTO PC (gli aggiornamenti non toccano questo file). Dopo una modifica: riavvia.cmd",
    "@rem Cartella dei dati (database, backup, log): fuori dalla cartella del programma.",
    "set PAZIENTI_DATA_DIR=$dati",
    "@rem Per scaricare gli aggiornamenti da un repository GitHub privato serve un token di sola lettura:",
    "@rem set PAZIENTI_GITHUB_TOKEN=github_pat_...",
    "@rem Altre impostazioni di impostazioni.cmd si possono ridefinire qui (es. set PAZIENTI_PORTA=8080)."
  )
  Set-Content -Path $Locali -Value $testo -Encoding ascii
  Ok "Creato windows\impostazioni-locali.cmd (dati in $DatiDir)"
}

function Attivita { return Get-ScheduledTask -TaskName $NomeAttivita -ErrorAction SilentlyContinue }

# Al primo avvio il server crea l'admin con una password casuale scritta in questo file
function Mostra-PasswordIniziale {
  $f = Join-Path $DatiDir "PASSWORD-INIZIALE-ADMIN.txt"
  if (Test-Path $f) {
    Write-Host ""
    Scrivi "  Primo accesso dell'amministratore (il file si cancella da solo dopo il cambio password):" Cyan
    Get-Content $f | Where-Object { $_ -match '^(Email|Password):' } | ForEach-Object { Write-Host "      $_" -ForegroundColor White }
    Scrivi "      (file: $f)"
  }
}

function Server-Risponde {
  try {
    $r = Invoke-WebRequest -Uri "$Url/api/public-config" -UseBasicParsing -TimeoutSec 3
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Processi-Porta {
  $c = Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue
  return @($c | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 })
}

function Attendi-Server([int]$secondi = 40) {
  for ($i = 0; $i -lt $secondi; $i++) {
    if (Server-Risponde) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

# --- installa ------------------------------------------------------------------------
function Trova-Python {
  # preferisce versioni con pacchetti gia' pronti per Windows (le versioni appena uscite a volte non li hanno)
  $candidati = @(@("py", "-3.13"), @("py", "-3.12"), @("py", "-3.11"), @("py", "-3.14"), @("py", "-3.10"), @("py", "-3"), @("python"), @("python3"))
  foreach ($c in $candidati) {
    $exe = $c[0]; $extra = @($c | Select-Object -Skip 1)
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { continue }
    try {
      $v = & $exe @extra -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
    } catch { continue }
    if ($LASTEXITCODE -eq 0 -and $v -match '^(\d+)\.(\d+)$') {
      if ([int]$Matches[1] -eq 3 -and [int]$Matches[2] -ge 10) { return @($exe) + $extra }
      Errore "Trovato Python $v, ma serve Python 3.10 o successivo."
    }
  }
  return $null
}

function Installa {
  Scrivi "== Installazione di Gestione Pazienti $(Versione) in $Progetto ==" Cyan
  Prepara-ImpostazioniLocali
  $py = @(Trova-Python)
  if ($py.Count -eq 0) {
    Errore "Python 3.10+ non trovato. Installalo da https://www.python.org/downloads/ (spunta 'Add python.exe to PATH') e riprova."
    Fine 1
  }
  Ok "Python: $(& $py[0] @($py | Select-Object -Skip 1) --version)"
  $DistIndex = Join-Path $Frontend "dist\index.html"
  $conNode = [bool](Get-Command npm -ErrorAction SilentlyContinue)
  if ($conNode) { Ok "Node.js: $(node --version)" }
  elseif (Test-Path $DistIndex) { Scrivi "  --  Node.js non trovato: uso il frontend gia' compilato incluso nel progetto." Yellow }
  else {
    Errore "Node.js non trovato e frontend\dist mancante. Installa Node.js LTS da https://nodejs.org/ e riprova."
    Fine 1
  }

  $inEsecuzione = (Processi-Porta).Count -gt 0
  if ($inEsecuzione) { Scrivi "Il server e' acceso: lo fermo per aggiornarlo..." Yellow; Ferma | Out-Null }

  Push-Location $Backend
  try {
    $versione = & $py[0] @($py | Select-Object -Skip 1) -c "import sys; print(sys.version.split()[0])"
    if (Test-Path $PythonVenv) {
      $versioneVenv = & $PythonVenv -c "import sys; print(sys.version.split()[0])"
      if ($versioneVenv -ne $versione) {
        Scrivi "L'ambiente esistente usa Python ${versioneVenv}: lo ricreo con Python $versione..." Yellow
        Remove-Item -Recurse -Force (Join-Path $Backend ".venv")
      }
    }
    if (-not (Test-Path $PythonVenv)) {
      Scrivi "Creo l'ambiente Python (backend\.venv)..."
      & $py[0] @($py | Select-Object -Skip 1) -m venv .venv
      if ($LASTEXITCODE -ne 0) { Errore "Creazione dell'ambiente Python non riuscita."; Fine 1 }
    }
    Scrivi "Installo le librerie Python..."
    & $PythonVenv -m pip install --upgrade pip --quiet --disable-pip-version-check
    $Lock = Join-Path $Backend "requirements.lock.txt"
    if (Test-Path $Lock) {
      Scrivi "  (versioni fissate da requirements.lock.txt)"
      & $PythonVenv -m pip install -r requirements.lock.txt --quiet --disable-pip-version-check
    } else {
      & $PythonVenv -m pip install -r requirements.txt --quiet --disable-pip-version-check
      if ($LASTEXITCODE -eq 0) {
        & $PythonVenv -m pip freeze --exclude pip --exclude setuptools | Set-Content -Encoding ascii $Lock
        Ok "Versioni delle librerie salvate in backend\requirements.lock.txt (da salvare anche su git)"
      }
    }
    if ($LASTEXITCODE -ne 0) {
      Errore "pip install non riuscito."
      Scrivi "  Se l'errore parla di 'Microsoft Visual C++' o 'Rust', la tua versione di Python e' troppo nuova:" Yellow
      Scrivi "  installa Python 3.13 da https://www.python.org/downloads/ e rilancia installa.cmd (lo usera' da solo)." Yellow
      Fine 1
    }
    $importOk = $false
    try { & $PythonVenv -c "import fastapi, pydantic_core, uvicorn, sqlite3" 2>$null; $importOk = ($LASTEXITCODE -eq 0) } catch { }
    if (-not $importOk) {
      Errore "Le librerie Python sono installate ma Windows ne blocca il caricamento (Smart App Control?)."
      Scrivi "  Prova: $PythonVenv -c `"import fastapi, pydantic_core`" per vedere il messaggio completo." Yellow
      Fine 1
    }
    Ok "Backend pronto"
  } finally { Pop-Location }

  if ($conNode) {
    $Dist = Join-Path $Frontend "dist"
    $Copia = Join-Path $env:TEMP "gestione-pazienti-dist-backup"
    if (Test-Path $Copia) { Remove-Item -Recurse -Force $Copia }
    if (Test-Path $DistIndex) { Copy-Item -Recurse $Dist $Copia }
    $compilato = $false
    Push-Location $Frontend
    try {
      Scrivi "Installo le librerie del frontend (npm install)..."
      if (Test-Path (Join-Path $Frontend "package-lock.json")) { & npm ci --no-audit --no-fund }
      if (-not (Test-Path (Join-Path $Frontend "package-lock.json")) -or $LASTEXITCODE -ne 0) { & npm install --no-audit --no-fund }
      if ($LASTEXITCODE -eq 0) {
        Scrivi "Compilo il frontend (npm run build)..."
        & npm run build
        $compilato = ($LASTEXITCODE -eq 0) -and (Test-Path $DistIndex)
      }
    } catch { $compilato = $false }
    finally { Pop-Location }
    if ($compilato) {
      Ok "Frontend compilato in frontend\dist"
    } elseif (Test-Path (Join-Path $Copia "index.html")) {
      if (Test-Path $Dist) { Remove-Item -Recurse -Force $Dist }
      Copy-Item -Recurse $Copia $Dist
      Scrivi "  --  Compilazione del frontend non riuscita (vedi sopra): uso il frontend gia' compilato incluso nel progetto." Yellow
      Scrivi "      Serve ricompilarlo solo se modifichi il codice in frontend\src." Yellow
    } else {
      Errore "Compilazione del frontend non riuscita e nessun frontend gia' compilato disponibile."
      Fine 1
    }
    if (Test-Path $Copia) { Remove-Item -Recurse -Force $Copia }
  }

  if ($inEsecuzione) { Avvia | Out-Null }
  Write-Host ""
  Ok "Installazione completata."
  Scrivi "Prossimo passo: doppio clic su windows\attiva-avvio-automatico.cmd (avvio automatico all'accensione)" Cyan
  Scrivi "oppure windows\avvia.cmd per accenderlo solo adesso. Poi apri $Url"
}

# --- avvio automatico ------------------------------------------------------------------
function Attiva-AvvioAutomatico {
  Richiedi-Amministratore
  if (-not (Test-Path $PythonVenv)) { Errore "Prima esegui installa.cmd."; Fine 1 }
  $utente = if ($Utente) { $Utente } else { "$env:USERDOMAIN\$env:USERNAME" }

  $azione  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$AvviaServer`"" -WorkingDirectory $Backend
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $trigger.Delay = "PT20S"
  # S4U = parte all'accensione anche senza fare login, con l'utente di Windows indicato (nessuna password salvata)
  $chi     = New-ScheduledTaskPrincipal -UserId $utente -LogonType S4U -RunLevel Limited
  $regole  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
               -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
               -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $NomeAttivita -Action $azione -Trigger $trigger -Principal $chi -Settings $regole `
    -Description "Server Gestione Pazienti ($Url). Gestito da $PSCommandPath" -Force | Out-Null
  Ok "Avvio automatico attivato: il server partira' a ogni accensione del PC (utente $utente), anche senza login."

  if (Server-Risponde) { Scrivi "Il server era gia' acceso: lo riavvio sotto l'attivita' pianificata..."; Ferma | Out-Null }
  Avvia | Out-Null
}

function Disattiva-AvvioAutomatico {
  Richiedi-Amministratore
  if (Attivita) {
    Ferma | Out-Null
    Unregister-ScheduledTask -TaskName $NomeAttivita -Confirm:$false
    Ok "Avvio automatico disattivato e server spento. Per riaccenderlo a mano: avvia.cmd"
  } else {
    Scrivi "L'avvio automatico non era attivo."
  }
}

# --- avvia / ferma / riavvia -------------------------------------------------------------
function Avvia {
  if (-not (Test-Path $PythonVenv)) { Errore "Prima esegui installa.cmd."; Fine 1 }
  if (Server-Risponde) { Ok "Il server e' gia' acceso: $Url"; return $true }
  if ((Processi-Porta).Count -gt 0) {
    Errore "La porta $Porta e' occupata da un altro programma. Cambiala in windows\impostazioni.cmd."; Fine 1
  }
  if (-not (Test-Path $DatiDir)) { New-Item -ItemType Directory -Path $DatiDir | Out-Null }
  Remove-Item $FlagFermato -ErrorAction SilentlyContinue
  $t = Attivita
  if ($t) {
    if ($t.State -eq "Disabled") { Enable-ScheduledTask -TaskName $NomeAttivita | Out-Null }
    Start-ScheduledTask -TaskName $NomeAttivita | Out-Null
  } else {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$AvviaServer`"" -WorkingDirectory $Backend -WindowStyle Hidden
  }
  Scrivi "Avvio in corso..."
  if (Attendi-Server) {
    Ok "Server acceso: $Url"
    Mostra-PasswordIniziale
    if (-not $t) { Scrivi "  (avvio manuale: dopo uno spegnimento del PC non ripartira'. Per l'avvio automatico: attiva-avvio-automatico.cmd)" Yellow }
    return $true
  }
  Errore "Il server non risponde. Ultime righe del log ($Log):"
  if (Test-Path $Log) { Get-Content $Log -Tail 25 | ForEach-Object { Write-Host "      $_" } }
  return $false
}

function Ferma {
  if (-not (Test-Path $DatiDir)) { New-Item -ItemType Directory -Path $DatiDir | Out-Null }
  Set-Content -Path $FlagFermato -Value (Get-Date -Format s)      # avvia-server.cmd non deve riavviarlo
  $t = Attivita
  if ($t -and $t.State -eq "Running") { Stop-ScheduledTask -TaskName $NomeAttivita | Out-Null }
  # processi del server (python -m app, il cmd che lo lancia) e chi occupa la porta
  $pids = @(Processi-Porta)
  try {
    $pids += Get-CimInstance Win32_Process | Where-Object {
      $_.CommandLine -and (($_.CommandLine -like "*avvia-server.cmd*") -or
                           ($_.CommandLine -like "*-m app*" -and $_.CommandLine -like "*--port $Porta*"))
    } | Select-Object -ExpandProperty ProcessId
  } catch { }
  foreach ($id in ($pids | Sort-Object -Unique)) {
    try { Stop-Process -Id $id -Force -ErrorAction Stop } catch { }
  }
  for ($i = 0; $i -lt 10 -and (Processi-Porta).Count -gt 0; $i++) { Start-Sleep -Milliseconds 500 }
  if ((Processi-Porta).Count -gt 0) {
    Errore "Non riesco a fermare il server: riprova facendo clic destro su ferma.cmd > Esegui come amministratore."
    return $false
  }
  Ok "Server spento."
  if ($t) { Scrivi "  L'avvio automatico resta attivo: alla prossima accensione del PC il server ripartira'." }
  return $true
}

function Stato {
  Scrivi "== Gestione Pazienti $(Versione) ==" Cyan
  Scrivi "   Dati: $DatiDir"
  if (Server-Risponde) { Ok "Server ACCESO: $Url" } else { Errore "Server SPENTO (porta $Porta)" }
  Mostra-PasswordIniziale
  $t = Attivita
  if ($t) {
    $info = Get-ScheduledTaskInfo -TaskName $NomeAttivita
    Ok "Avvio automatico ATTIVO (utente $($t.Principal.UserId), stato attivita': $($t.State), ultimo avvio: $($info.LastRunTime))"
  } else {
    Scrivi "  --  Avvio automatico NON attivo (attivalo con attiva-avvio-automatico.cmd)" Yellow
  }
  if (Test-Path $Log) {
    Scrivi "Ultime righe del log ($Log):"
    Get-Content $Log -Tail 8 | ForEach-Object { Write-Host "      $_" }
  }
}

# --- aggiorna -----------------------------------------------------------------------------
# Copia di sicurezza del database a server spento (file .db e, se presenti, -wal/-shm)
function Backup-Database([string]$motivo) {
  foreach ($dir in @($DatiDir, $VecchiDati)) {
    $db = Join-Path $dir "pazienti.db"
    if (-not (Test-Path $db)) { continue }
    $dest = Join-Path $dir "backup"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $nome = "pazienti-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$motivo.db"
    Copy-Item $db (Join-Path $dest $nome)
    foreach ($ext in @("-wal", "-shm")) { if (Test-Path "$db$ext") { Copy-Item "$db$ext" (Join-Path $dest "$nome$ext") } }
    Ok "Backup del database: $(Join-Path $dest $nome)"
  }
}

function Scarica-Codice {
  # 1) progetto scaricato con git: basta git pull
  if ((Test-Path (Join-Path $Progetto ".git")) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    Scrivi "Scarico l'ultima versione con git..."
    & git -C $Progetto pull --ff-only | Out-Host      # Out-Host: l'output di git non deve diventare il valore restituito
    if ($LASTEXITCODE -ne 0) {
      Errore "git pull non riuscito. Se hai modificato dei file in questa cartella, controlla con: git -C `"$Progetto`" status"
      return $false
    }
    return $true
  }
  # 2) progetto scaricato come zip: scarico l'ultima versione da GitHub e la copio sopra (dati esclusi)
  if (-not $Imp.PAZIENTI_REPO) { Errore "Repository non impostato (PAZIENTI_REPO in impostazioni.cmd)."; return $false }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $url = "https://api.github.com/repos/$($Imp.PAZIENTI_REPO)/zipball/$($Imp.PAZIENTI_RAMO)"
  $headers = @{ "User-Agent" = "GestionePazienti"; "Accept" = "application/vnd.github+json" }
  if ($Imp.PAZIENTI_GITHUB_TOKEN) { $headers["Authorization"] = "Bearer $($Imp.PAZIENTI_GITHUB_TOKEN)" }
  $tmp = Join-Path $env:TEMP "gestione-pazienti-aggiornamento"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp "versione.zip"
  Scrivi "Scarico l'ultima versione da GitHub ($($Imp.PAZIENTI_REPO))..."
  try {
    Invoke-WebRequest -Uri $url -Headers $headers -OutFile $zip -UseBasicParsing
  } catch {
    Errore "Download non riuscito: $($_.Exception.Message)"
    Scrivi "  Se il repository e' privato serve un token: PAZIENTI_GITHUB_TOKEN in windows\impostazioni-locali.cmd (vedi README)." Yellow
    return $false
  }
  Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp "x") -Force
  $src = Get-ChildItem (Join-Path $tmp "x") -Directory | Select-Object -First 1
  if (-not $src -or -not (Test-Path (Join-Path $src.FullName "backend\app\version.py"))) { Errore "Il file scaricato non sembra Gestione Pazienti."; return $false }
  Get-ChildItem -Recurse $src.FullName | Unblock-File
  # copia il programma; NON tocca: dati, ambiente Python, librerie npm, impostazioni locali
  & robocopy $src.FullName $Progetto /E /NFL /NDL /NJH /NJS /NP `
      /XD (Join-Path $src.FullName "backend\data") (Join-Path $src.FullName "backend\.venv") (Join-Path $src.FullName "frontend\node_modules") `
      /XF "impostazioni-locali.cmd" "impostazioni-locali.sh" | Out-Null
  if ($LASTEXITCODE -ge 8) { Errore "Copia dei file non riuscita (robocopy $LASTEXITCODE)."; return $false }
  # il frontend compilato va sostituito per intero (i nomi dei file cambiano a ogni versione)
  & robocopy (Join-Path $src.FullName "frontend\dist") (Join-Path $Frontend "dist") /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  return $true
}

function Aggiorna {
  $prima = Versione
  Scrivi "== Aggiornamento di Gestione Pazienti (versione attuale $prima) ==" Cyan
  Scrivi "   I dati restano in $DatiDir e non vengono toccati."
  $eraAcceso = Server-Risponde
  if ($eraAcceso -or (Processi-Porta).Count -gt 0) { Scrivi "Fermo il server..."; Ferma | Out-Null }
  Backup-Database "pre-aggiornamento"
  if (-not (Scarica-Codice)) {
    if ($eraAcceso) { Avvia | Out-Null }
    Fine 1
  }
  $dopo = Versione
  if ($dopo -eq $prima) { Ok "Gia' all'ultima versione ($dopo): reinstallo comunque le librerie." } else { Ok "Scaricata la versione $dopo." }
  # installazione e avvio con lo script NUOVO (potrebbe essere cambiato)
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath installa
  if ($LASTEXITCODE -ne 0) { Errore "Installazione non completata: il database e' intatto, vedi i messaggi sopra."; Fine 1 }
  if ($eraAcceso -or (Attivita)) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath avvia }
  Write-Host ""
  Ok "Aggiornamento completato: $prima -> $dopo. Il database viene adattato alla nuova versione all'avvio (con backup automatico)."
}

function Apri-Firewall {
  Richiedi-Amministratore
  $nome = "Gestione Pazienti (TCP $Porta)"
  Get-NetFirewallRule -DisplayName $nome -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $nome -Direction Inbound -Protocol TCP -LocalPort $Porta -Action Allow -Profile Domain,Private | Out-Null
  Ok "Porta $Porta aperta nel firewall (reti di dominio e private)."
  Scrivi "  Ricorda: dagli altri PC l'app funziona solo via HTTPS (vedi README)." Yellow
}

# con l'avvio automatico attivo il server gira come attivita' pianificata: per controllarla servono i permessi di amministratore
if ($Azione -in @("avvia", "ferma", "riavvia", "aggiorna") -and (Attivita) -and -not (E-Amministratore)) { Richiedi-Amministratore }

try {
  switch ($Azione) {
    "installa"                   { Installa }
    "attiva-avvio-automatico"    { Attiva-AvvioAutomatico }
    "disattiva-avvio-automatico" { Disattiva-AvvioAutomatico }
    "avvia"                      { if (-not (Avvia)) { Fine 1 } }
    "ferma"                      { if (-not (Ferma)) { Fine 1 } }
    "riavvia"                    { Ferma | Out-Null; if (-not (Avvia)) { Fine 1 } }
    "stato"                      { Stato }
    "apri-firewall"              { Apri-Firewall }
    "aggiorna"                   { Aggiorna }
  }
} catch {
  Errore $_.Exception.Message
  Fine 1
}
Fine 0
