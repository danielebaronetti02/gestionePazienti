"""Controlli condivisi sui dati in ingresso."""
import re

from .. import config
from ..errors import Invalid

_BLOB_RE = re.compile(r"^v1\.[A-Za-z0-9+/]+={0,2}$")
_B64_RE = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")
_HEX64_RE = re.compile(r"^[0-9a-f]{64}$")


def check_blob(value, label="dato cifrato", required=True):
    """Dato cifrato nel browser: 'v1.' + base64(iv + testo cifrato AES-GCM)."""
    if value is None and not required:
        return None
    if not isinstance(value, str) or not _BLOB_RE.match(value) or len(value) > config.MAX_BLOB_LEN:
        raise Invalid(f"Formato non valido: {label}.")
    return value


def check_b64(value, label, max_len=20_000):
    if not isinstance(value, str) or not _B64_RE.match(value) or len(value) > max_len:
        raise Invalid(f"Formato non valido: {label}.")
    return value


def check_index(value):
    """Indice HMAC del codice fiscale (64 caratteri esadecimali) oppure None."""
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not _HEX64_RE.match(value):
        raise Invalid("Formato non valido: indice del codice fiscale.")
    return value


def check_grants(grants, need_identity: bool):
    """Chiavi dell'archivio avvolte per un utente: 'clinical' sempre, 'identity' se ha il permesso."""
    grants = grants or {}
    out = {"clinical": check_b64(grants.get("clinical"), "chiave clinica")}
    if need_identity:
        out["identity"] = check_b64(grants.get("identity"), "chiave anagrafica")
    return out


def save_grants(db, user_id, grants: dict, granted_by):
    for name, wrapped in grants.items():
        db.execute("""INSERT INTO key_grants (user_id, key_name, wrapped_key, granted_by) VALUES (?,?,?,?)
                      ON CONFLICT(user_id, key_name) DO UPDATE SET wrapped_key = excluded.wrapped_key,
                      granted_by = excluded.granted_by, granted_at = datetime('now', 'localtime')""",
                   (user_id, name, wrapped, granted_by))
