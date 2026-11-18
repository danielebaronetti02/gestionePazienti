# Gestione Pazienti – webapp (React + FastAPI + SQLite) con cifratura nel browser

Archivio pazienti dell'unità: schede, esami, grafici dell'andamento, visite, dashboard, esportazione Excel, account con ruoli e registro accessi.

**I dati dei pazienti sono cifrati e decifrati solo nel browser.** Il server e il database contengono soltanto dati cifrati e non possiedono le chiavi: chi ottiene una copia del database non può leggere nomi, note, esami o risultati.

| Livello | Tecnologia |
|---|---|
| Frontend | React 19 + Vite, crittografia con **WebCrypto** (nativa del browser), Excel generato nel browser |
| Backend | FastAPI (Python 3.10+): accesso, permessi, conservazione dei dati cifrati |
| Database | SQLite (`pazienti.db` nella cartella `GestionePazienti-dati`, fuori dal programma) |

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

Poi aprite **<http://localhost:8000>** nel browser e fate il primo accesso con la password iniziale (vedi sezione 4).

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
| `aggiorna.cmd` | **scarica e installa l'ultima versione** senza toccare i dati (vedi sezione [Aggiornamenti](#aggiornamenti)) |
| `installa.cmd` | prima installazione, oppure reinstallazione delle librerie (ferma e riaccende il server da solo) |

In sintesi:
- **server acceso + spegnete il PC** → alla riaccensione riparte da solo;
- **`ferma.cmd`** → spento fino al prossimo `avvia.cmd` o alla prossima accensione del PC;
- **`disattiva-avvio-automatico.cmd`** → spento finché non lo riaccendete voi.

Con l'avvio automatico attivo, anche `avvia`, `ferma` e `riavvia` chiedono la conferma di amministratore, perché controllano l'attività pianificata.

**Impostazioni:**
- `windows\impostazioni.cmd` contiene i valori predefiniti e fa parte del programma: un aggiornamento può sostituirlo.
- Le impostazioni di **questo PC** (cartella dei dati, porta, token GitHub…) vanno in `windows\impostazioni-locali.cmd`. Lo crea `installa.cmd` e gli aggiornamenti non lo toccano mai.
- Dopo una modifica eseguite `riavvia.cmd`.

**Dati e log:** nella cartella **`%USERPROFILE%\GestionePazienti-dati`** (es. `C:\Users\mario\GestionePazienti-dati`), *fuori* dalla cartella del programma. Contiene `pazienti.db`, `backup\` e `server.log`; oltre 5 MB il log diventa `server.old.log`. `stato.cmd` mostra il percorso esatto.

Le stesse azioni sono disponibili anche da PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File windows\gestione.ps1 stato        # oppure: installa, avvia, ferma, riavvia,
                                                                            # aggiorna, attiva-avvio-automatico, disattiva-avvio-automatico, apri-firewall
```

## 4. Primo accesso e gestione degli utenti

- **Amministratore iniziale:** al primo avvio il server crea l'account `admin@uniroma1.it` con una **password casuale**, diversa per ogni installazione.
  - La password si trova nel file `PASSWORD-INIZIALE-ADMIN.txt` nella cartella dei dati. La mostrano anche `avvia.cmd`, `attiva-avvio-automatico.cmd` e `stato.cmd`.
  - Al primo accesso **la password va cambiata** obbligatoriamente. In quel momento il browser crea le chiavi dell'archivio e il file con la password iniziale **si cancella da solo**.
  - Fate il primo accesso subito dopo l'installazione: finché non lo fate, chi legge quel file può entrare come amministratore.
- **Regole per le password**, controllate nel browser perché il server non vede mai le password:
  - almeno 12 caratteri;
  - almeno 3 tipi tra minuscole, maiuscole, numeri e simboli, oppure una frase di almeno 16 caratteri;
  - non sono accettate password comuni (`Password2026!`, `Forzaroma…`), sequenze, caratteri ripetuti né il proprio nome o la propria email.
- **Tentativi sbagliati:** dopo 5 errori sullo stesso account, l'accesso si blocca per 5 minuti. Dopo 20 errori dallo stesso computer in 15 minuti, quel computer è bloccato per 15 minuti. I blocchi restano attivi anche se il server viene riavviato.
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
| `aggiorna.command` | scarica e installa l'ultima versione senza toccare i dati |

- L'avvio automatico usa un servizio `launchd` (`~/Library/LaunchAgents/local.gestione-pazienti.plist`), che riparte da solo anche se il server si blocca.
- Su Mac parte **al login dell'utente**, non prima. Se il Mac fa da server, attivate il login automatico in *Impostazioni di Sistema → Utenti e gruppi*.
- Valori predefiniti in `mac/impostazioni.sh`; quelli di questo Mac in `mac/impostazioni-locali.sh`, che gli aggiornamenti non toccano.
- Dati, backup e log sono in `~/GestionePazienti-dati`.

## 5. Accesso da altri PC della rete

Per sicurezza il server risponde **solo a questo PC** (`PAZIENTI_HOST=127.0.0.1`). Aprirlo alla rete in HTTP non servirebbe, perché l'app non funziona comunque, ed esporrebbe solo la pagina di accesso a tentativi dalla rete.

La crittografia del browser (WebCrypto) funziona **solo su `https://` oppure su `http://localhost`**. Ne segue che:

- **sul PC che ospita il server** l'indirizzo `http://localhost:8000` funziona sempre;
- **dagli altri PC** `http://<ip-del-server>:8000` **non basta**: l'app mostra “Connessione non sicura”. Serve un indirizzo HTTPS, con un certificato del servizio informatico oppure un reverse proxy come Caddy o IIS, davanti alla porta 8000. Con HTTPS impostate anche `set PAZIENTI_HTTPS=1` in `impostazioni.cmd`;
- se il proxy HTTPS gira **sullo stesso PC**, lasciate `127.0.0.1`. Se gira su un'altra macchina, impostate `PAZIENTI_HOST=0.0.0.0` e limitate l'accesso alla porta 8000 a quella macchina con il firewall;
- `windows\gestione.ps1 apri-firewall` apre la porta nel firewall di Windows, per le reti private e di dominio.

## 6. Backup

Tutti i dati stanno in **`pazienti.db`**, nella cartella dei dati (`%USERPROFILE%\GestionePazienti-dati`, su Mac `~/GestionePazienti-dati`).

**Backup automatici**, nella sottocartella `backup`:

| Quando | File | Quanti se ne tengono |
|---|---|---|
| ogni giorno, a server acceso | `pazienti-AAAAMMGG-HHMMSS-giornaliero.db` | gli ultimi 30 |
| prima di ogni aggiornamento | `…-pre-aggiornamento.db` | gli ultimi 10 |
| prima di ogni modifica della struttura del database | `…-pre-migrazione.db` | gli ultimi 10 |

Questi backup stanno **sullo stesso disco**: proteggono da errori e aggiornamenti, non da un guasto del PC.

**Copiate regolarmente la cartella `backup`** su un supporto separato, come un disco esterno o una cartella di rete dell'unità.

Per ripristinare un backup:
1. spegnete il server con `ferma`;
2. rinominate `pazienti.db`;
3. copiate al suo posto il backup scelto, rinominato `pazienti.db`;
4. riaccendete il server con `avvia`.

Inoltre:
- Il file contiene solo dati cifrati, quindi il backup non espone i pazienti.
- Senza almeno un account funzionante, però, il backup non è leggibile.

## 7. Importare prescrizioni e referti (PDF o foto)

Nella scheda del paziente, **Esami → 📄 Importa da PDF o foto**:

1. scegliete il **PDF** oppure una o più **foto**, una per pagina, con il foglio dritto e ben illuminato;
2. il programma riconosce se è una **prescrizione** (promemoria della ricetta elettronica) o un **referto di laboratorio**;
3. mostra un'**anteprima** da controllare:
   - **codice fiscale:** confrontato con quello del paziente. Se è diverso l'importazione si blocca finché non confermate. Da foto, un codice fiscale letto male viene riconosciuto tramite il carattere di controllo;
   - **date:** nella prescrizione, la data e la data prevista calcolata dalla priorità (U 3 giorni, B 10, D 60, P 120); nel referto, la data del prelievo e del referto;
   - **righe:** per ognuna, il tipo di esame del catalogo abbinato (modificabile) e, nei referti, il valore (modificabile), l'unità, l'intervallo di riferimento e il segno ⚠ se fuori range;
4. con **Importa**:
   - le **prescrizioni** diventano esami da effettuare, con nelle note il codice della ricetta (NRE), il medico, il quesito e la priorità;
   - i **referti** completano gli esami già prescritti e ancora aperti dello stesso tipo, oppure creano nuovi risultati. Gruppi come “Esame delle urine” o l'emocromo diventano un unico risultato riassuntivo.

**Come vengono riconosciuti gli esami:** con il **codice del nomenclatore** (es. `90.42.1` = TSH) e con i **sinonimi** del catalogo (es. “Glicemia” = “Glucosio”). Si modificano in *Cataloghi → Modifica*. Le righe non riconosciute non vengono importate, a meno di scegliere un tipo a mano; l'amministratore può anche crearne uno nuovo al volo. Importare due volte lo stesso documento non crea doppioni: le righe già presenti vengono riconosciute.

**Dove vengono letti i documenti:**
- **PDF con testo:** letti **nel browser**, il documento non arriva al server.
- **Foto e PDF scansionati:** il testo viene riconosciuto sul **PC server** dal programma gratuito **Tesseract OCR**, in memoria, senza salvare l'immagine; il registro accessi annota solo dimensione e numero di righe. È l'unico caso in cui un dato in chiaro passa dal server. L'OCR può sbagliare una virgola o una cifra, quindi **controllate i valori** prima di importare.

**Installare Tesseract** (solo per le foto, sul PC server):
- **Windows:** installatore da <https://github.com/UB-Mannheim/tesseract/wiki>; durante l'installazione, in *Additional language data*, spuntate **Italian**. Il programma lo trova da solo in `C:\Program Files\Tesseract-OCR`; altrimenti indicate il percorso con `PAZIENTI_TESSERACT` in `impostazioni-locali.cmd`.
- **Mac:** `brew install tesseract tesseract-lang`.
- Poi `riavvia`. Se Tesseract non c'è, la pagina lo segnala e i PDF funzionano comunque.

## 8. Stampa della cartella clinica, tema e menu dell'account

- **Stampa / PDF:** nella scheda del paziente, il pulsante **🖨 Stampa / PDF** apre l'anteprima della cartella clinica.
  - **Contenuto:** intestazione con data e autore della stampa, anagrafica, dati clinici e note, esami raggruppati per categoria (con intervalli e ⚠), grafici dell'andamento e storico visite.
  - **Sezioni a scelta:** si può togliere l'anagrafica per una copia pseudonimizzata, stampare solo gli esami con risultato o escludere le note degli esami.
  - **PDF:** nella finestra di stampa scegliete **“Salva come PDF”**.
  - **Privacy:** il documento è composto nel browser, quindi i dati non passano in chiaro dal server. Ogni stampa viene annotata nel registro accessi.
- **Menu dell'account:** cliccando sul **proprio nome**, in alto a destra, si apre il menu con **Modifica password**, la scelta del **tema** e **Esci**.
- **Tema giorno / notte:** dal menu dell'account, *Giorno*, *Notte* oppure *Automatico* (segue l'impostazione del computer). La scelta resta salvata in quel browser. La stampa esce sempre su fondo bianco.

## 9. Eliminazioni (solo amministratori)

- **Paziente:** in fondo alla scheda, *Elimina paziente*. Per conferma va scritto il codice del paziente. Elimina scheda, esami e visite; resta solo nei backup. Per toglierlo dagli elenchi senza cancellarlo usate **Archivia**.
- **Tipi di esame e patologie:** in *Cataloghi*, *Elimina*, attivo solo per le voci **mai usate**. Il controllo lo fa il browser dell'amministratore, perché i dati clinici sul server sono cifrati. Le voci in uso si possono solo **disattivare**: spariscono dai menu ma restano sugli esami già registrati.
- I medici possono eliminare solo singoli esami e le visite registrate da loro.

## Aggiornamenti

Quando pubblicate una nuova versione su GitHub (`git push`), chi ha installato il programma la riceve con **`windows\aggiorna.cmd`** (su Mac `aggiorna.command`). **I dati non vengono mai sovrascritti:**

1. **Il programma e i dati sono separati.** I dati stanno in `GestionePazienti-dati` e le impostazioni del PC in `impostazioni-locali.*`. L'aggiornamento sostituisce solo i file del programma.
2. **Prima di tutto un backup** del database (`…-pre-aggiornamento.db`).
3. **Download:**
   - se il programma è stato scaricato con `git clone`, fa `git pull`;
   - altrimenti scarica lo zip dell'ultima versione da GitHub (`PAZIENTI_REPO` in `impostazioni.cmd`) e lo copia sopra il programma, escludendo dati, ambiente Python e impostazioni locali.
4. **Installazione e avvio:** reinstalla le librerie e riavvia il server.
5. **Aggiornamento del database:** all'avvio, se la nuova versione ha cambiato la struttura del database, il server la aggiorna da solo. Prima fa un altro backup (`…-pre-migrazione.db`), poi applica le **migrazioni**, che aggiungono e non cancellano mai. Se qualcosa va storto, la modifica viene annullata e il database resta com'era.

Un programma **più vecchio** del database si rifiuta di partire, invece di rovinare i dati: succede se qualcuno rimette una versione precedente sopra dati già aggiornati.

**Repository privato:** lo zip si scarica senza credenziali solo se il repository è **pubblico**. Il codice non contiene dati né password, quindi si può rendere pubblico. Per tenerlo privato, create un token di sola lettura:
1. su GitHub, *Settings → Developer settings → Fine-grained tokens*;
2. scegliete solo questo repository, con permesso *Contents: Read-only*;
3. su ogni PC mettetelo in `impostazioni-locali.cmd`, con `set PAZIENTI_GITHUB_TOKEN=github_pat_...` (su Mac `impostazioni-locali.sh`).

**Per chi pubblica una nuova versione (sviluppatore):**
- aumentate `APP_VERSION` in `backend/app/version.py`;
- se cambiate la struttura del database, aumentate anche `SCHEMA_VERSION` e aggiungete la funzione `migrate_to_N` in `backend/app/migrations.py`; le regole sono scritte in cima al file;
- se avete modificato `frontend/src`, ricompilate (`npm run build`) e includete `frontend/dist` nel commit;
- poi `git commit` e `git push`.

**Primo aggiornamento da una versione precedente alla 3.1:** le versioni vecchie non hanno `aggiorna.cmd`. La prima volta:
1. spegnete il server con `ferma.cmd`;
2. sostituite i file del programma, con `git pull` oppure copiando la nuova cartella sopra quella vecchia;
3. lanciate `installa.cmd`.

Al primo avvio il database viene **spostato da solo** da `backend\data` a `GestionePazienti-dati`, e al suo posto resta un file `DATI-SPOSTATI.txt` con il nuovo percorso. Da lì in poi basta `aggiorna.cmd`.

## 10. Lista di controllo prima di inserire pazienti reali

1. **Autorizzazioni:** fatevi approvare il trattamento dal **DPO** e dal servizio informatico dell'ospedale o dell'università: registro dei trattamenti ed eventuale DPIA. Concordate su quale macchina far girare il server; un portatile personale di solito non è accettato.
2. **Cartella dati fuori da OneDrive:** quella predefinita (`%USERPROFILE%\GestionePazienti-dati`) non è sincronizzata da OneDrive. Se preferite un'altra posizione (es. `C:\GestionePazienti\dati`), cambiate `PAZIENTI_DATA_DIR` in `impostazioni-locali.cmd`: a server spento spostate prima il contenuto della vecchia cartella, poi `avvia.cmd`.
3. **Disco cifrato:** attivate **BitLocker** sul PC server (su Mac, **FileVault**).
4. **Sistema del PC server:** aggiornamenti automatici attivi, blocco schermo con password e possibilmente un account di Windows dedicato al server, senza permessi di amministratore.
5. **Almeno due amministratori**, più una **credenziale di emergenza** (un account amministratore la cui password sta in busta chiusa in un armadio). Senza un amministratore funzionante l'archivio non si può più leggere.
6. **Copia dei backup** su un supporto separato (sezione 6) e una prova di ripristino.
7. **Controllo periodico delle librerie**, per esempio una volta al mese:
   ```powershell
   cd backend
   .venv\Scripts\python -m pip install pip-audit
   .venv\Scripts\pip-audit -r requirements.lock.txt
   ```
   Se segnala vulnerabilità: cancellate `requirements.lock.txt`, rieseguite `installa.cmd` (aggiorna le librerie e ricrea il lock) e salvate il lock su git.
8. **Dati in chiaro:** nel documento per il DPO va indicato che restano leggibili sul server:
   - email, nomi e ruoli degli utenti;
   - codici pseudonimi dei pazienti e cataloghi;
   - date di creazione e modifica dei record;
   - numero di esami e visite per paziente;
   - registro accessi (utente, azione, IP).

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
# 1) backend → http://127.0.0.1:8000
cd backend
.venv\Scripts\activate
$env:PAZIENTI_API_DOCS = "1"       # facoltativo: documentazione API su /api/docs (spenta in produzione)
uvicorn app.main:app --reload

# 2) frontend con ricarica automatica → http://localhost:5173  (le chiamate /api vanno al backend)
cd frontend
npm run dev
```

Se il server automatico è acceso sulla porta 8000, spegnetelo prima con `windows\ferma.cmd`. Finite le modifiche, rieseguite `windows\installa.cmd` per ricompilare il frontend.

Test di sviluppo dei documenti di esempio (dati inventati) in `frontend/tests/fixtures/`.

## Configurazione

Si imposta in `windows\impostazioni-locali.cmd` (Mac: `mac/impostazioni-locali.sh`), oppure con variabili d'ambiente.

| Variabile | Significato | Default |
|---|---|---|
| `PAZIENTI_PORTA` / `PAZIENTI_HOST` | porta e indirizzo di ascolto (solo script Windows) | `8000` / `127.0.0.1` |
| `PAZIENTI_DATA_DIR` | cartella dati (database, backup, log) | `%USERPROFILE%\GestionePazienti-dati` |
| `PAZIENTI_REPO` / `PAZIENTI_RAMO` | repository GitHub e ramo da cui `aggiorna` scarica | `danielebaronetti02/gestionePazienti` / `main` |
| `PAZIENTI_GITHUB_TOKEN` | token di sola lettura per aggiornare da un repository privato | — |
| `PAZIENTI_TESSERACT` | percorso di Tesseract OCR (lettura delle foto) | ricerca automatica |
| `PAZIENTI_BACKUP` | `0` = niente backup giornaliero automatico | attivo |
| `PAZIENTI_ADMIN_EMAIL` / `PAZIENTI_ADMIN_PASSWORD` / `PAZIENTI_ADMIN_NAME` | amministratore creato al primo avvio (solo se non esiste ancora nessun utente) | `admin@uniroma1.it` / **casuale** (nel file `PASSWORD-INIZIALE-ADMIN.txt`) / `Amministratore` |
| `PAZIENTI_TEMP_PASSWORD_HOURS` | validità delle password temporanee | `72` |
| `PAZIENTI_SESSION_MINUTES` | minuti di inattività dopo cui la sessione si chiude | `5` |
| `PAZIENTI_HTTPS` | `1` = cookie di sessione solo su HTTPS | — |
| `PAZIENTI_API_DOCS` | `1` = documentazione delle API su `/api/docs` (solo sviluppo) | spenta |
| `PAZIENTI_KDF_ITERATIONS` | iterazioni PBKDF2 — **non modificare dopo l'installazione** | `600000` |

## Struttura

```
windows/                   # Windows: installa, avvio automatico, avvia/ferma/riavvia/stato (gestione.ps1 + file .cmd)
mac/                       # Mac: stessi comandi (gestione.sh + file .command, launchd)
backend/app/
├── main.py  __main__.py   # app FastAPI (errori, CSRF, intestazioni, serve il frontend) · avvio
├── config.py  constants.py  schema.sql  db.py   # configurazione, cataloghi, tabelle, admin iniziale
├── version.py  migrations.py  backup.py       # versione · aggiornamento dei database esistenti · backup
├── security.py            # verifica accesso (scrypt), sessioni, blocco tentativi, registro
├── context.py  errors.py  schemas.py  deps.py  utils.py
├── routers/               # auth.py · vault.py · admin.py   (sottili)
└── services/              # auth.py (accesso, chiavi) · vault.py (archivio cifrato) · admin.py (utenti, cataloghi) · ocr.py (foto)
backend/tests/             # test_services.py (logica, SQLite reale) · test_api.py (HTTP, TestClient)

frontend/src/
├── crypto/                # vaultCrypto.js (chiavi, ECDH, AES-GCM, indice CF) · keyCache.js (chiavi per la scheda)
├── vault.js               # apertura chiavi, decifratura dell'archivio, salvataggi cifrati, credenziali nuovi utenti
├── domain.js              # stato esami, ritardi, ricerca, filtri, dashboard, andamenti
├── excel/                 # generatore .xlsx senza dipendenze · esportazione
├── importDocs/            # lettura PDF (pdf.js) e foto (OCR), riconoscimento di prescrizioni e referti
├── passwordPolicy.js      # regole delle password
├── App.jsx  api.js  router.jsx  appContext.jsx  hooks.js  format.js  styles.css
├── components/            # Layout, tabella esami, grafico andamento, badge
├── theme.js               # modalità giorno / notte
└── pages/                 # Accesso, Dashboard, Pazienti, Scheda, Esami, Importa, Stampa, Esporta, Amministrazione
frontend/public/pdf.worker.min.mjs   # lettore PDF (pdf.js), stessa versione di package.json
frontend/tests/            # crypto.test.mjs · import.test.mjs + fixtures/ (documenti di esempio con dati inventati)
```

## Test

```powershell
cd backend;  .venv\Scripts\python -m pytest tests -q
cd frontend; npm test            # crittografia + lettura di prescrizioni e referti
```
