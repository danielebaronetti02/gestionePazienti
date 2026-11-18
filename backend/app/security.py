"""Sicurezza lato server: verifica dell'accesso, sessioni, blocco tentativi, registro accessi.

Il server NON conosce le password né le chiavi dei dati. Dal browser riceve solo
"auth_hash", un valore derivato dalla password che serve a farsi riconoscere
ma non permette di decifrare nulla (la chiave di cifratura è derivata a parte).
"""
import base64
import datetime as dt
import hashlib
import hmac
import re
import secrets
import time
import unicodedata

from . import config
from .utils import now

# ---------------------------------------------------------------------------
# Derivazione dalla password: IDENTICA a frontend/src/crypto/keys.js
#   master    = PBKDF2-SHA256(password NFC, salt = prefisso + email minuscola, iterazioni, 32 byte)
#   auth_hash = HMAC-SHA256(master, "auth")      → inviato al server
#   kek       = HMAC-SHA256(master, "enc")       → resta nel browser (cifra la chiave privata)
# ---------------------------------------------------------------------------
def kdf_master(email: str, password: str) -> bytes:
    salt = (config.KDF_SALT_PREFIX + email.strip().lower()).encode()
    pw = unicodedata.normalize("NFC", password).encode()
    return hashlib.pbkdf2_hmac("sha256", pw, salt, config.KDF_ITERATIONS, 32)


def derive_auth_hash(email: str, password: str) -> str:
    """Usato solo per creare l'amministratore di seed (e nei test)."""
    return base64.b64encode(hmac.new(kdf_master(email, password), b"auth", hashlib.sha256).digest()).decode()


# ---------------------------------------------------------------------------
# auth_hash salvato con scrypt (sale casuale): una copia del DB non permette di accedere
# ---------------------------------------------------------------------------
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1}


def hash_secret(value: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(value.encode(), salt=salt, dklen=32, **_SCRYPT)
    b64 = lambda b: base64.b64encode(b).decode()
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${b64(salt)}${b64(digest)}"


def verify_secret(value: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt((value or "").encode(), salt=base64.b64decode(salt), dklen=len(expected),
                                n=int(n), r=int(r), p=int(p))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


_AUTH_HASH_RE = re.compile(r"^[A-Za-z0-9+/]{43}=$")   # 32 byte in base64


def valid_auth_hash(value: str) -> bool:
    return bool(value) and bool(_AUTH_HASH_RE.match(value))


# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------
_EMAIL_RE = re.compile(r"^[a-z0-9._%+\-]+@([a-z0-9\-]+\.)+[a-z]{2,}$")


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def email_problem(email: str):
    """Qualsiasi indirizzo email con un formato valido."""
    if not _EMAIL_RE.match(normalize_email(email)):
        return "Indirizzo email non valido."
    return None


# ---------------------------------------------------------------------------
# Sessioni lato server: il cookie contiene un token casuale, nel DB solo il suo hash
# ---------------------------------------------------------------------------
def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db, user_id: int, ip: str = None) -> str:
    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions (token_hash, user_id, last_seen, ip) VALUES (?,?,?,?)",
               (_sha256(token), user_id, now(), ip))
    return token


def user_from_session(db, token: str):
    """Utente attivo collegato al token, oppure None se la sessione non esiste o è scaduta."""
    if not token:
        return None
    th = _sha256(token)
    row = db.execute("""SELECT u.*, s.last_seen AS session_last_seen FROM sessions s
                        JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.active = 1""", (th,)).fetchone()
    if row is None:
        return None
    # +1 minuto di tolleranza: il browser chiude la sessione esattamente a SESSION_MINUTES di inattività
    # e, mentre l'utente è attivo, la tiene viva con una richiesta ogni 20 secondi
    if dt.datetime.now() - dt.datetime.fromisoformat(row["session_last_seen"]) > dt.timedelta(minutes=config.SESSION_MINUTES + 1):
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (th,))
        db.commit()
        return None
    db.execute("UPDATE sessions SET last_seen = ? WHERE token_hash = ?", (now(), th))
    db.commit()
    user = dict(row)
    user.pop("session_last_seen", None)
    return user


def delete_session(db, token: str):
    if token:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (_sha256(token),))


def delete_user_sessions(db, user_id: int, except_token: str = None):
    if except_token:
        db.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", (user_id, _sha256(except_token)))
    else:
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def purge_expired_sessions(db):
    limit = (dt.datetime.now() - dt.timedelta(minutes=config.SESSION_MINUTES + 1)).strftime("%Y-%m-%d %H:%M:%S")
    db.execute("DELETE FROM sessions WHERE last_seen < ?", (limit,))


# ---------------------------------------------------------------------------
# Blocco temporaneo dopo troppi tentativi
# ---------------------------------------------------------------------------
_failures = {}


def is_locked(key: str) -> bool:
    return _failures.get(key, (0, 0))[1] > time.time()


def register_failure(key: str):
    fails = _failures.get(key, (0, 0))[0] + 1
    _failures[key] = (fails, time.time() + config.LOCK_SECONDS if fails >= config.MAX_FAILED_LOGINS else 0)


def reset_failures(key: str = None):
    if key is None:
        _failures.clear()
    else:
        _failures.pop(key, None)


# ---------------------------------------------------------------------------
# Registro accessi
# ---------------------------------------------------------------------------
def audit(ctx, action, patient_code=None, details=None, username=None):
    """Scrive una voce nel registro (commit a carico del chiamante)."""
    u = ctx.user
    ctx.db.execute(
        "INSERT INTO audit_log (user_id, username, action, patient_code, details, ip) VALUES (?,?,?,?,?,?)",
        (u["id"] if u else None, username or (u["email"] if u else None), action, patient_code, details, ctx.ip))
