"""Aggiornamento dei database creati con versioni precedenti del programma.

La versione dello schema è salvata nel database (PRAGMA user_version):
  0 = database della prima versione (prima che esistesse questo meccanismo) → trattato come 1
  N = già aggiornato alla versione N

Regole per chi modifica il programma:
  * MAI cancellare o rinominare colonne/tabelle con dati: aggiungere, copiare, poi eventualmente ignorare.
  * Ogni migrazione è una funzione migrate_to_N(con) registrata in MIGRATIONS, eseguita una sola volta,
    dentro una transazione, dopo un backup automatico (backup/pazienti-...-pre-migrazione.db).
"""
from .constants import DEFAULT_EXAMS, DEFAULT_PATHOLOGIES
from .version import SCHEMA_VERSION


class DatabaseTooNew(RuntimeError):
    pass


def _columns(con, table: str) -> set:
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}


def _add_column(con, table: str, column: str, decl: str):
    if column not in _columns(con, table):
        con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def sync_catalogs(con):
    """Aggiunge ai cataloghi le voci predefinite mancanti e completa codici/sinonimi vuoti.
    Non tocca né elimina le voci esistenti (nemmeno quelle disattivate)."""
    for category, name, unit, code, aliases in DEFAULT_EXAMS:
        row = con.execute("SELECT id, code, aliases FROM exam_types WHERE name = ?", (name,)).fetchone()
        if row is None:
            con.execute("INSERT INTO exam_types (category, name, unit, code, aliases) VALUES (?,?,?,?,?)",
                        (category, name, unit or None, code or None, aliases or None))
        else:
            con.execute("UPDATE exam_types SET code = COALESCE(code, ?), aliases = COALESCE(aliases, ?) WHERE id = ?",
                        (code or None, aliases or None, row[0]))
    for name in DEFAULT_PATHOLOGIES:
        con.execute("INSERT OR IGNORE INTO pathologies (name) VALUES (?)", (name,))


def migrate_to_2(con):
    """3.1: codice nomenclatore e sinonimi nei tipi di esame; nuove voci nei cataloghi."""
    _add_column(con, "exam_types", "code", "TEXT")
    _add_column(con, "exam_types", "aliases", "TEXT")
    sync_catalogs(con)


MIGRATIONS = {2: migrate_to_2}


def schema_version(con) -> int:
    return con.execute("PRAGMA user_version").fetchone()[0]


def pending(con) -> list[int]:
    v = schema_version(con) or 1
    if v > SCHEMA_VERSION:
        raise DatabaseTooNew(
            f"Il database è della versione {v} ma questo programma arriva alla {SCHEMA_VERSION}: "
            "aggiorna il programma (non usare una versione più vecchia su dati più recenti).")
    return list(range(v + 1, SCHEMA_VERSION + 1))


def run(con, steps: list[int]):
    for n in steps:
        con.execute("BEGIN")
        try:
            MIGRATIONS[n](con)
            con.execute(f"PRAGMA user_version = {n}")
            con.execute("COMMIT")
        except Exception:
            con.execute("ROLLBACK")
            raise
