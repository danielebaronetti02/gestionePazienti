"""Database SQLite: connessione, schema, cataloghi iniziali e amministratore di seed."""
import os
import sqlite3

from . import config
from .constants import DEFAULT_EXAMS, DEFAULT_PATHOLOGIES


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA busy_timeout = 5000")
    return con


def init_db() -> bool:
    """Crea tabelle, cataloghi e (se non c'è nessun utente) l'amministratore di seed.

    Restituisce True se l'amministratore è stato creato ora.
    """
    from . import security
    os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)
    con = connect()
    try:
        with open(config.SCHEMA_PATH, encoding="utf-8") as fh:
            con.executescript(fh.read())
        if not con.execute("SELECT 1 FROM pathologies").fetchone():
            con.executemany("INSERT INTO pathologies (name) VALUES (?)", [(n,) for n in DEFAULT_PATHOLOGIES])
        if not con.execute("SELECT 1 FROM exam_types").fetchone():
            con.executemany("INSERT INTO exam_types (category, name, unit) VALUES (?,?,?)",
                            [(c, n, u or None) for c, n, u in DEFAULT_EXAMS])
        seeded = False
        if not con.execute("SELECT 1 FROM users").fetchone():
            problem = security.email_problem(config.SEED_ADMIN_EMAIL)
            if problem:
                raise RuntimeError(f"PAZIENTI_ADMIN_EMAIL non valida: {problem}")
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
