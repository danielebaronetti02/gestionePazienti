"""Configurazione: percorsi e parametri letti dalle variabili d'ambiente."""
import os

APP_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(APP_DIR)
PROJECT_DIR = os.path.dirname(BACKEND_DIR)

DATA_DIR = os.environ.get("PAZIENTI_DATA_DIR", os.path.join(BACKEND_DIR, "data"))
DB_PATH = os.environ.get("PAZIENTI_DB", os.path.join(DATA_DIR, "pazienti.db"))
SCHEMA_PATH = os.path.join(APP_DIR, "schema.sql")
FRONTEND_DIST = os.environ.get("PAZIENTI_FRONTEND_DIST", os.path.join(PROJECT_DIR, "frontend", "dist"))

# Amministratore creato al primo avvio (password da cambiare al primo accesso)
SEED_ADMIN_EMAIL = os.environ.get("PAZIENTI_ADMIN_EMAIL", "admin@uniroma1.it").strip().lower()
SEED_ADMIN_NAME = os.environ.get("PAZIENTI_ADMIN_NAME", "Amministratore")
SEED_ADMIN_PASSWORD = os.environ.get("PAZIENTI_ADMIN_PASSWORD", "Cambiami-subito-2026")

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
MIN_PASSWORD_LEN = 10
MAX_FAILED_LOGINS = 5
LOCK_SECONDS = 300
TEMP_PASSWORD_HOURS = int(os.environ.get("PAZIENTI_TEMP_PASSWORD_HOURS", "72"))  # validità password temporanea
MAX_BLOB_LEN = 200_000   # dimensione massima di un dato cifrato
