"""Configurazione: percorsi e parametri letti dalle variabili d'ambiente."""
import os

APP_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(APP_DIR)
PROJECT_DIR = os.path.dirname(BACKEND_DIR)

# I dati stanno FUORI dalla cartella del programma: aggiornare o riscaricare il programma non li tocca.
# (Fino alla 3.0 stavano in backend/data: vengono spostati qui automaticamente al primo avvio, vedi db.move_legacy_data.)
DATA_DIR = os.environ.get("PAZIENTI_DATA_DIR") or os.path.join(os.path.expanduser("~"), "GestionePazienti-dati")
DB_PATH = os.environ.get("PAZIENTI_DB", os.path.join(DATA_DIR, "pazienti.db"))
SCHEMA_PATH = os.path.join(APP_DIR, "schema.sql")
FRONTEND_DIST = os.environ.get("PAZIENTI_FRONTEND_DIST", os.path.join(PROJECT_DIR, "frontend", "dist"))

# Amministratore creato al primo avvio (password da cambiare al primo accesso)
SEED_ADMIN_EMAIL = os.environ.get("PAZIENTI_ADMIN_EMAIL", "admin@uniroma1.it").strip().lower()
SEED_ADMIN_NAME = os.environ.get("PAZIENTI_ADMIN_NAME", "Amministratore")
# Se PAZIENTI_ADMIN_PASSWORD non è impostata, al primo avvio viene generata una password casuale
# e scritta in SEED_PASSWORD_FILE (nella cartella dati), che si cancella da solo al primo cambio password.
SEED_ADMIN_PASSWORD = os.environ.get("PAZIENTI_ADMIN_PASSWORD") or None
SEED_PASSWORD_FILENAME = "PASSWORD-INIZIALE-ADMIN.txt"


def seed_password_file() -> str:
    return os.path.join(os.path.dirname(DB_PATH), SEED_PASSWORD_FILENAME)

# Derivazione della chiave dalla password (PBKDF2-SHA256), eseguita nel BROWSER.
# Il server la usa solo per l'admin di seed. NON modificare dopo l'installazione:
# gli utenti esistenti non riuscirebbero più ad accedere.
KDF_ITERATIONS = int(os.environ.get("PAZIENTI_KDF_ITERATIONS", "600000"))
KDF_SALT_PREFIX = "gestione-pazienti|"

# Sessione e sicurezza
SESSION_COOKIE = "gp_session"
SESSION_MINUTES = int(os.environ.get("PAZIENTI_SESSION_MINUTES", "5"))   # chiusura dopo N minuti senza attività
COOKIE_SECURE = os.environ.get("PAZIENTI_HTTPS") == "1"
CSRF_HEADER = "X-Requested-With"
CSRF_VALUE = "GestionePazienti"
MIN_PASSWORD_LEN = 12          # verificata nel browser (il server non vede mai la password)
MAX_FAILED_LOGINS = 5          # per account: dopo 5 errori blocco di LOCK_SECONDS
LOCK_SECONDS = 300
MAX_FAILED_PER_IP = 20         # per indirizzo IP: dopo 20 errori in IP_WINDOW_SECONDS blocco di IP_LOCK_SECONDS
IP_WINDOW_SECONDS = 900
IP_LOCK_SECONDS = 900
API_DOCS = os.environ.get("PAZIENTI_API_DOCS") == "1"
BACKUP_ENABLED = os.environ.get("PAZIENTI_BACKUP", "1") != "0"   # backup giornaliero automatico del database
# OCR delle foto (importazione referti): programma Tesseract installato sul PC server. Vuoto = ricerca automatica.
TESSERACT_CMD = os.environ.get("PAZIENTI_TESSERACT", "")
OCR_MAX_BYTES = 15 * 1024 * 1024   # documentazione /api/docs (solo per sviluppo)
TEMP_PASSWORD_HOURS = int(os.environ.get("PAZIENTI_TEMP_PASSWORD_HOURS", "72"))  # validità password temporanea
MAX_BLOB_LEN = 200_000   # dimensione massima di un dato cifrato
