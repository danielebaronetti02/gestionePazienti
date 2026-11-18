"""Backup del database (copia coerente anche a server acceso, con l'API di backup di SQLite).

Uso da riga di comando (lo usano gli script di aggiornamento):
    python -m app.backup [motivo]
"""
import glob
import os
import sqlite3
import sys
from datetime import datetime, timedelta

from . import config

KEEP = {"giornaliero": 30, "pre-migrazione": 10, "pre-aggiornamento": 10, "manuale": 20}


def backup_dir() -> str:
    return os.path.join(os.path.dirname(config.DB_PATH), "backup")


def make_backup(reason: str = "manuale") -> str | None:
    """Copia il database in backup/pazienti-AAAAMMGG-HHMMSS-<motivo>.db. Restituisce il percorso (None se non c'è il db)."""
    if not os.path.exists(config.DB_PATH):
        return None
    os.makedirs(backup_dir(), exist_ok=True)
    path = os.path.join(backup_dir(), f"pazienti-{datetime.now():%Y%m%d-%H%M%S}-{reason}.db")
    src = sqlite3.connect(config.DB_PATH)
    dst = sqlite3.connect(path)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    _prune(reason)
    return path


def _prune(reason: str):
    files = sorted(glob.glob(os.path.join(backup_dir(), f"pazienti-*-{reason}.db")))
    for old in files[:-KEEP.get(reason, 20)]:
        try:
            os.remove(old)
        except OSError:
            pass


def last_backup_time(reason: str) -> datetime | None:
    files = sorted(glob.glob(os.path.join(backup_dir(), f"pazienti-*-{reason}.db")))
    if not files:
        return None
    return datetime.fromtimestamp(os.path.getmtime(files[-1]))


def daily_backup_if_due(hours: int = 20) -> str | None:
    last = last_backup_time("giornaliero")
    if last and datetime.now() - last < timedelta(hours=hours):
        return None
    return make_backup("giornaliero")


if __name__ == "__main__":
    out = make_backup(sys.argv[1] if len(sys.argv) > 1 else "manuale")
    print(out or "Nessun database da salvare.")
