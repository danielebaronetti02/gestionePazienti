"""Contesto di una richiesta: connessione al database, utente collegato, IP.

I servizi ricevono un Context invece di dipendere da FastAPI: così la logica
si può usare e testare anche senza il server web.
"""
from dataclasses import dataclass
import sqlite3

from .errors import Forbidden, Unauthorized


@dataclass
class Context:
    db: sqlite3.Connection
    user: dict = None
    ip: str = None

    # --- permessi --------------------------------------------------------
    @property
    def can_edit(self) -> bool:
        return self.user is not None and self.user["role"] in ("admin", "medico")

    @property
    def can_view_identity(self) -> bool:
        return self.user is not None and bool(self.user["can_view_identity"])

    @property
    def is_admin(self) -> bool:
        return self.user is not None and self.user["role"] == "admin"

    def require_user(self):
        if self.user is None:
            raise Unauthorized("Accesso richiesto.")

    def require_edit(self):
        self.require_user()
        if not self.can_edit:
            raise Forbidden("Il tuo profilo è di sola consultazione.")

    def require_identity(self):
        self.require_user()
        if not self.can_view_identity:
            raise Forbidden("Il tuo profilo non è abilitato ai dati anagrafici.")

    def require_admin(self):
        self.require_user()
        if not self.is_admin:
            raise Forbidden("Funzione riservata agli amministratori.")
