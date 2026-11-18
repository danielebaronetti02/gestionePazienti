# Gestione Pazienti – webapp (React + FastAPI + SQLite) con cifratura nel browser

Archivio pazienti dell'unità: schede, esami, grafici dell'andamento, visite, dashboard, esportazione Excel, account con ruoli e registro accessi.

**I dati dei pazienti sono cifrati e decifrati solo nel browser.** Il server e il database contengono soltanto dati cifrati e non possiedono le chiavi: chi ottiene una copia del database non può leggere nomi, note, esami o risultati.

| Livello | Tecnologia |
|---|---|
| Frontend | React 19 + Vite, crittografia con **WebCrypto** (nativa del browser), Excel generato nel browser |
| Backend | FastAPI (Python 3.10+): accesso, permessi, conservazione dei dati cifrati |
| Database | SQLite (`backend/data/pazienti.db`) |

---

Il programma è lo stesso su **Windows** e su **Mac**. Cambiano solo gli script di installazione e di avvio automatico:
- su Windows si usa la cartella **`windows\`** (file `.cmd`, attività pianificata di Windows), descritta nelle sezioni 1–3;
- su Mac si usa la cartella **`mac/`** (file `.command`, `launchd`), descritta nella sezione [Su Mac](#su-mac).

## 1. Prima installazione su Windows

Serve una sola volta per PC (e di nuovo dopo ogni aggiornamento del codice).

**Prerequisiti** (da installare una volta):
- **Python 3.10 o successivo** da <https://www.python.org/downloads/>: nell'installazione spuntate **“Add python.exe to PATH”**. Non usate la versione del Microsoft Store.
- **Node.js LTS** da <https://nodejs.org/>: **facoltativo**. Il frontend è già compilato in `frontend\dist`; Node.js serve solo se modificate il codice in `frontend\src`.

> **Smart App Control (Windows 11):** può bloccare i file nativi di alcune librerie, con un messaggio come *“Un criterio di controllo dell'applicazione ha bloccato il file”*. Per il frontend `package.json` usa già la versione WebAssembly di rollup. Se la compilazione fallisce comunque, l'installazione prosegue con il frontend già compilato.

**Installazione:** doppio clic su **`windows\installa.cmd`**. Lo script:
1. crea l'ambiente Python in `backend\.venv` e installa le librerie;
2. se Node.js è installato, prova a ricompilare il frontend (`npm install` e `npm run build`); altrimenti usa quello già compilato.

<details>
<summary>Gli stessi passaggi a mano, da PowerShell</summary>

```powershell
cd C:\Users\<utente>\Desktop\gestione-pazienti-web\backend
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt

cd ..\frontend
npm install
npm run build

cd ..\backend
.venv\Scripts\python -m app --port 8000      # server acceso finché la finestra resta aperta
```
</details>

Poi aprite **<http://localhost:8000>** nel browser.

## 2. Avvio automatico all'accensione del PC

Doppio clic su **`windows\attiva-avvio-automatico.cmd`** e confermate la richiesta di Windows (servono i permessi di amministratore).

- Viene creata l'attività pianificata **“GestionePazienti”**. Il server parte **a ogni accensione del PC**, anche prima del login, e la porta 8000 resta sempre attiva.
- Se il server si chiude per un errore, riparte da solo dopo 5 secondi.
- Gira con il vostro utente Windows, senza salvare la sua password.

## 3. Spegnere e riaccendere il server

Tutti i comandi sono nella cartella `windows\` e si usano con un doppio clic:

| File | Cosa fa |
|---|---|
| `stato.cmd` | dice se il server è acceso, se l'avvio automatico è attivo e mostra le ultime righe del log |
| `ferma.cmd` | **spegne il server adesso**. L'avvio automatico resta attivo: **alla prossima accensione del PC il server riparte** |
| `avvia.cmd` | riaccende il server senza riavviare il PC |
| `riavvia.cmd` | spegne e riaccende (da usare dopo aver cambiato `impostazioni.cmd`) |
| `disattiva-avvio-automatico.cmd` | spegne il server e toglie l'avvio automatico: all'accensione il server non partirà più |
| `installa.cmd` | prima installazione, oppure aggiornamento dopo una modifica del codice (ferma e riaccende il server da solo) |

In sintesi:
- **server acceso + spegnete il PC** → alla riaccensione riparte da solo;
- **`ferma.cmd`** → spento fino al prossimo `avvia.cmd` o alla prossima accensione del PC;
- **`disattiva-avvio-automatico.cmd`** → spento finché non lo riaccendete voi.

Con l'avvio automatico attivo, anche `avvia`, `ferma` e `riavvia` chiedono la conferma di amministratore, perché controllano l'attività pianificata.

**Impostazioni:** in `windows\impostazioni.cmd` si cambiano la porta (default `8000`), l'indirizzo di ascolto e le altre opzioni. Dopo una modifica eseguite `riavvia.cmd`.

**Log:** `backend\data\server.log`. Oltre 5 MB il vecchio file diventa `server.old.log`.

Le stesse azioni sono disponibili anche da PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File windows\gestione.ps1 stato        # oppure: installa, avvia, ferma, riavvia,
                                                                            # attiva-avvio-automatico, disattiva-avvio-automatico, apri-firewall
```

## 4. Primo accesso e gestione degli utenti

- **Amministratore iniziale**, creato automaticamente al primo avvio:

  | Email | Password |
  |---|---|
  | `admin@uniroma1.it` | `Cambiami-subito-2026` |

  Al primo accesso **la password va cambiata** obbligatoriamente, e in quel momento il browser crea le chiavi dell'archivio. Si possono cambiare email e password iniziali prima del primo avvio, con le variabili in fondo alla pagina.
- **L'amministratore** fa tutto quello che fa un medico (pazienti, esami, visite, esportazione). Inoltre, dal menu **Utenti**, può **vedere, aggiungere, modificare ed eliminare** gli altri utenti. Gestisce anche i **Cataloghi** e il **Registro accessi**.
- **Nuovo utente** (*Utenti → + Nuovo utente*):
  - si indicano nome, email (qualsiasi indirizzo valido), ruolo (Amministratore / Medico / Sola consultazione) e il permesso di vedere l'anagrafica;
  - il browser genera una **password temporanea**, che compare **una sola volta** sullo schermo con il pulsante *Copia*: comunicatela all'utente;
  - vale 72 ore e al primo accesso l'utente la sostituisce con una personale;
  - il server non la riceve mai, conserva solo un'impronta non reversibile.
- **Password dimenticata o scaduta:** *Utenti → Modifica → Imposta nuova password temporanea*. Compare a schermo come per un nuovo utente.
- **Eliminare un utente:** pulsante *Elimina* nell'elenco, oppure nella scheda dell'utente. L'utente non può più accedere, mentre pazienti, esami e visite che ha inserito restano nell'archivio. Per sospenderlo senza cancellarlo, togliete la spunta *Account attivo*.
- **Protezioni:** un amministratore non può eliminare o declassare se stesso, e deve sempre restare almeno un amministratore attivo.
- **Tenete almeno due amministratori.** Se l'unico amministratore perde la password, nessuno può reimpostarla e l'archivio non è più leggibile, perché il server non ha le chiavi.
- **Sessione:** si chiude da sola dopo **5 minuti senza attività** (né mouse né tastiera). Finché è attiva, **ricaricare la pagina non richiede la password**; aprendo una nuova scheda del browser invece viene richiesta.

## Su Mac

I comandi sono gli stessi di Windows, ma nella cartella `mac/` e con l'estensione `.command`. Si usano con doppio clic, oppure dal Terminale con `mac/gestione.sh <azione>`.

1. **Spostate il progetto nella cartella Inizio**, per esempio `/Users/<nome>/gestione-pazienti-web`, e **non** su Scrivania, Documenti o Download. macOS impedisce ai servizi automatici di leggere quelle cartelle, e lo script si rifiuta di attivare l'avvio automatico se il progetto è lì.
2. **Prerequisiti:** Python 3.13 da <https://www.python.org/downloads/macos/>. Il Python preinstallato su macOS è troppo vecchio. Node.js è facoltativo, come su Windows.
3. **La prima volta**, macOS può bloccare i file `.command` scaricati (“sviluppatore non identificato”). Aprite il Terminale una volta e date:
   ```bash
   cd ~/gestione-pazienti-web
   xattr -dr com.apple.quarantine .        # toglie il blocco di Gatekeeper
   chmod +x mac/*.command mac/*.sh         # rende eseguibili gli script
   ```
4. Doppio clic su **`installa.command`**, poi su **`attiva-avvio-automatico.command`**, e aprite <http://localhost:8000>.

| File | Cosa fa |
|---|---|
| `stato.command` | server acceso? avvio automatico attivo? ultime righe del log |
| `ferma.command` | spegne adesso; **all'accensione successiva riparte** |
| `avvia.command` / `riavvia.command` | riaccende senza riavviare il Mac |
| `disattiva-avvio-automatico.command` | spegne e toglie l'avvio automatico |

- L'avvio automatico usa un servizio `launchd` (`~/Library/LaunchAgents/local.gestione-pazienti.plist`), che riparte da solo anche se il server si blocca.
- Su Mac parte **al login dell'utente**, non prima. Se il Mac fa da server, attivate il login automatico in *Impostazioni di Sistema → Utenti e gruppi*.
- Le impostazioni (porta e indirizzo di ascolto) sono in `mac/impostazioni.sh`.
- Il log è in `backend/data/server.log`.

## 5. Accesso da altri PC della rete

La crittografia del browser (WebCrypto) funziona **solo su `https://` oppure su `http://localhost`**. Ne segue che:

- **sul PC che ospita il server** l'indirizzo `http://localhost:8000` funziona sempre;
- **dagli altri PC** `http://<ip-del-server>:8000` **non basta**: l'app mostra “Connessione non sicura”. Serve un indirizzo HTTPS, con un certificato del servizio informatico oppure un reverse proxy come Caddy o IIS, davanti alla porta 8000. Con HTTPS impostate anche `set PAZIENTI_HTTPS=1` in `impostazioni.cmd`;
- `windows\gestione.ps1 apri-firewall` apre la porta nel firewall di Windows, per le reti private e di dominio.

## 6. Backup

Tutti i dati stanno in **`backend\data\pazienti.db`**. Copiatelo regolarmente, a server spento oppure con lo strumento di backup di SQLite.
- Il file contiene solo dati cifrati, quindi il backup non espone i pazienti.
- Senza almeno un account funzionante, però, il backup non è leggibile.

## Come funziona la cifratura

```
password ─PBKDF2 (600.000 iterazioni)─► master ─┬─► auth_hash ──► server (solo per il login, salvato con scrypt)
                                                └─► kek ────────► resta nel browser
kek  ── protegge ──► chiave privata personale (ECDH P-256), salvata cifrata sul server
chiave privata ── apre ──► chiavi dell'archivio (AES-GCM 256), "avvolte" per ogni utente:
                            • clinical  → dati clinici, esami, visite, note
                            • identity  → anagrafica (solo per chi ha il permesso "Vede anagrafica")
```

- **La password non lascia mai il browser,** comprese le password temporanee generate dall'amministratore. Il server riceve solo `auth_hash`, che permette di farsi riconoscere ma non di decifrare nulla.
- **Ogni record è cifrato con AES-GCM,** quindi è protetto anche da modifiche. Restano in chiaro solo:
  - il codice pseudonimo del paziente;
  - i cataloghi (patologie ed esami);
  - i dati degli account (email, nome, ruolo).
- **Il permesso anagrafica è garantito crittograficamente:** chi non lo ha non riceve la chiave `identity`.
- **Nuovo utente o nuova password temporanea:** il browser dell'amministratore crea le chiavi dell'utente protette dalla password temporanea e gli "avvolge" le chiavi dell'archivio. Per questo può farlo solo un amministratore e non il server.
- **Duplicati di codice fiscale:** si rilevano con un indice HMAC calcolato nel browser.
- **Ricarica senza password:** le chiavi restano cifrate per la sola scheda del browser (`sessionStorage`), con una chiave non esportabile custodita in IndexedDB. Spariscono quando si chiude la scheda, quando si esce o dopo 5 minuti di inattività.
- **Cosa gira nel browser:** dashboard, ricerca, filtri, grafici ed Excel lavorano sui dati decifrati in memoria. Va bene per l'archivio di un'unità (centinaia o poche migliaia di pazienti).

## Sviluppo (modifica del codice)

```powershell
# 1) backend → http://127.0.0.1:8000  (documentazione API: /api/docs)
cd backend
.venv\Scripts\activate
uvicorn app.main:app --reload

# 2) frontend con ricarica automatica → http://localhost:5173  (le chiamate /api vanno al backend)
cd frontend
npm run dev
```

Se il server automatico è acceso sulla porta 8000, spegnetelo prima con `windows\ferma.cmd`. Finite le modifiche, rieseguite `windows\installa.cmd` per ricompilare il frontend.

> Se avete un database creato con una versione precedente, cancellate `backend\data\` (o rinominatela) prima di avviare: i vecchi account non sono compatibili.

## Configurazione

Si imposta in `windows\impostazioni.cmd`, con righe `set NOME=valore`, oppure con variabili d'ambiente.

| Variabile | Significato | Default |
|---|---|---|
| `PAZIENTI_PORTA` / `PAZIENTI_HOST` | porta e indirizzo di ascolto (solo script Windows) | `8000` / `0.0.0.0` |
| `PAZIENTI_DATA_DIR` | cartella dati (database, log) | `backend\data` |
| `PAZIENTI_ADMIN_EMAIL` / `PAZIENTI_ADMIN_PASSWORD` / `PAZIENTI_ADMIN_NAME` | amministratore creato al primo avvio (solo se non esiste ancora nessun utente) | `admin@uniroma1.it` / `Cambiami-subito-2026` / `Amministratore` |
| `PAZIENTI_TEMP_PASSWORD_HOURS` | validità delle password temporanee | `72` |
| `PAZIENTI_SESSION_MINUTES` | minuti di inattività dopo cui la sessione si chiude | `5` |
| `PAZIENTI_HTTPS` | `1` = cookie di sessione solo su HTTPS | — |
| `PAZIENTI_KDF_ITERATIONS` | iterazioni PBKDF2 — **non modificare dopo l'installazione** | `600000` |

## Struttura

```
windows/                   # Windows: installa, avvio automatico, avvia/ferma/riavvia/stato (gestione.ps1 + file .cmd)
mac/                       # Mac: stessi comandi (gestione.sh + file .command, launchd)
backend/app/
├── main.py  __main__.py   # app FastAPI (errori, CSRF, intestazioni, serve il frontend) · avvio
├── config.py  constants.py  schema.sql  db.py   # configurazione, cataloghi, tabelle, admin iniziale
├── security.py            # verifica accesso (scrypt), sessioni, blocco tentativi, registro
├── context.py  errors.py  schemas.py  deps.py  utils.py
├── routers/               # auth.py · vault.py · admin.py   (sottili)
└── services/              # auth.py (accesso, chiavi) · vault.py (archivio cifrato) · admin.py (utenti, cataloghi)
backend/tests/             # test_services.py (logica, SQLite reale) · test_api.py (HTTP, TestClient)

frontend/src/
├── crypto/                # vaultCrypto.js (chiavi, ECDH, AES-GCM, indice CF) · keyCache.js (chiavi per la scheda)
├── vault.js               # apertura chiavi, decifratura dell'archivio, salvataggi cifrati, credenziali nuovi utenti
├── domain.js              # stato esami, ritardi, ricerca, filtri, dashboard, andamenti
├── excel/                 # generatore .xlsx senza dipendenze · esportazione
├── App.jsx  api.js  router.jsx  appContext.jsx  hooks.js  format.js  styles.css
├── components/            # Layout, tabella esami, grafico andamento, badge
└── pages/                 # Accesso, Dashboard, Pazienti, Scheda, Esami, Esporta, Amministrazione
frontend/tests/crypto.test.mjs
```

## Test

```powershell
cd backend;  .venv\Scripts\python -m pytest tests -q
cd frontend; node tests/crypto.test.mjs
```
