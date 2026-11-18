"""Database SQLite: connessione, schema, cataloghi iniziali e amministratore di seed."""
import os
import sqlite3

from . import config
from . import migrations
from .backup import make_backup
from .constants import DEFAULT_EXAMS, DEFAULT_PATHOLOGIES
from .version import SCHEMA_VERSION


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA busy_timeout = 5000")
    return con


_PW_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _random_password() -> str:
    """Password leggibile di 4 gruppi da 5 caratteri (es. Xk7pQ-...), senza caratteri ambigui."""
    import secrets
    return "-".join("".join(secrets.choice(_PW_ALPHABET) for _ in range(5)) for _ in range(4))


def _write_seed_password(password: str):
    path = config.seed_password_file()
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("Gestione Pazienti - credenziali iniziali dell'amministratore\n\n"
                 f"Email:    {config.SEED_ADMIN_EMAIL}\nPassword: {password}\n\n"
                 "Al primo accesso la password va cambiata: dopo il cambio questo file viene cancellato da solo.\n")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def remove_seed_password_file():
    try:
        os.remove(config.seed_password_file())
    except FileNotFoundError:
        pass


LEGACY_DATA_DIR = os.path.join(config.BACKEND_DIR, "data")
_LEGACY_ITEMS = ("pazienti.db", "pazienti.db-wal", "pazienti.db-shm", config.SEED_PASSWORD_FILENAME, "backup")


def move_legacy_data() -> str | None:
    """Fino alla 3.0 i dati stavano in backend/data, dentro la cartella del programma.
    Ora stanno fuori (config.DATA_DIR), così sostituire o riscaricare il programma non li tocca.
    Se trova un database nella vecchia posizione e nessuno in quella nuova, lo sposta."""
    old_db = os.path.join(LEGACY_DATA_DIR, "pazienti.db")
    target = os.path.dirname(config.DB_PATH)
    if (os.path.abspath(target) == os.path.abspath(LEGACY_DATA_DIR) or not os.path.exists(old_db)
            or os.path.exists(config.DB_PATH)):
        return None
    import shutil
    os.makedirs(target, exist_ok=True)
    for name in _LEGACY_ITEMS:
        src = os.path.join(LEGACY_DATA_DIR, name)
        if os.path.exists(src):
            dst = config.DB_PATH if name == "pazienti.db" else os.path.join(target, name)
            shutil.move(src, dst)
    with open(os.path.join(LEGACY_DATA_DIR, "DATI-SPOSTATI.txt"), "w", encoding="utf-8") as fh:
        fh.write(f"I dati sono stati spostati in:\n{target}\n")
    return target


def init_db() -> bool:
    """Crea tabelle, cataloghi e (se non c'è nessun utente) l'amministratore di seed.

    Senza PAZIENTI_ADMIN_PASSWORD la password iniziale è casuale e viene scritta in
    config.seed_password_file(). Restituisce True se l'amministratore è stato creato ora.
    """
    from . import security
    os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)
    con = connect()
    try:
        is_new = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").fetchone() is None
        steps = [] if is_new else migrations.pending(con)
        if steps:                                   # database di una versione precedente: prima un backup
            con.close()
            saved = make_backup("pre-migrazione")
            print(f"Aggiornamento del database alla versione {steps[-1]} (backup: {saved})", flush=True)
            con = connect()
        with open(config.SCHEMA_PATH, encoding="utf-8") as fh:
            con.executescript(fh.read())             # crea solo le tabelle mancanti (IF NOT EXISTS)
        if is_new:
            con.executemany("INSERT OR IGNORE INTO pathologies (name) VALUES (?)", [(n,) for n in DEFAULT_PATHOLOGIES])
            con.executemany("INSERT OR IGNORE INTO exam_types (category, name, unit, code, aliases) VALUES (?,?,?,?,?)",
                            [(c, n, u or None, k or None, a or None) for c, n, u, k, a in DEFAULT_EXAMS])
            con.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            con.commit()
        else:
            migrations.run(con, steps)
        seeded = False
        if not con.execute("SELECT 1 FROM users").fetchone():
            problem = security.email_problem(config.SEED_ADMIN_EMAIL)
            if problem:
                raise RuntimeError(f"PAZIENTI_ADMIN_EMAIL non valida: {problem}")
            if not config.SEED_ADMIN_PASSWORD:
                config.SEED_ADMIN_PASSWORD = _random_password()
                _write_seed_password(config.SEED_ADMIN_PASSWORD)
            auth_hash = security.derive_auth_hash(config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD)
            con.execute("""INSERT INTO users (email, full_name, role, can_view_identity, must_change_pw, auth_hash)
                           VALUES (?,?,'admin',1,1,?)""",
                        (config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_NAME, security.hash_secret(auth_hash)))
            seeded = True
        con.commit()
        return seeded
    finally:
        con.close()


def get_state(con, key, default=None):
    row = con.execute("SELECT value FROM system_state WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_state(con, key, value):
    con.execute("INSERT INTO system_state (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value))
