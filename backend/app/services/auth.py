"""Accesso con email e password, chiavi personali, cambio password."""
from .. import config, security
from ..constants import ROLES
from ..db import get_state, remove_seed_password_file, set_state
from ..errors import Forbidden, Invalid, TooManyRequests, Unauthorized
from ..security import audit
from ..utils import now
from .common import check_b64, check_grants, save_grants



def public_config() -> dict:
    """Parametri che il browser deve conoscere prima del login."""
    return {
        "kdf_iterations": config.KDF_ITERATIONS,
        "kdf_salt_prefix": config.KDF_SALT_PREFIX,
        "session_minutes": config.SESSION_MINUTES,
        "min_password_len": config.MIN_PASSWORD_LEN,
        "temp_password_hours": config.TEMP_PASSWORD_HOURS,
    }


def grants_of(db, user_id) -> dict:
    return {r["key_name"]: r["wrapped_key"] for r in
            db.execute("SELECT key_name, wrapped_key FROM key_grants WHERE user_id = ?", (user_id,))}


def user_out(db, user: dict) -> dict:
    """Profilo dell'utente collegato, con permessi e stato delle chiavi."""
    granted = set(grants_of(db, user["id"]))
    return {
        "id": user["id"],
        "email": user["email"],
        "full_name": user["full_name"],
        "role": user["role"],
        "role_label": ROLES[user["role"]],
        "can_view_identity": bool(user["can_view_identity"]),
        "can_edit": user["role"] in ("admin", "medico"),
        "is_admin": user["role"] == "admin",
        "must_change_pw": bool(user["must_change_pw"]),
        "has_keys": user["public_key"] is not None,
        "has_access": "clinical" in granted,           # può decifrare l'archivio
        "keys_initialized": get_state(db, "keys_initialized") == "1",
    }


def key_material(ctx) -> dict:
    """Ciò che serve al browser per sbloccare l'archivio (tutto cifrato)."""
    ctx.require_user()
    grants = grants_of(ctx.db, ctx.user["id"])
    if not ctx.user["can_view_identity"]:
        grants.pop("identity", None)
    return {"public_key": ctx.user["public_key"], "enc_private_key": ctx.user["enc_private_key"], "grants": grants}


# ---------------------------------------------------------------------------
# Accesso
# ---------------------------------------------------------------------------
def login(ctx, email: str, auth_hash: str):
    email = security.normalize_email(email)
    db = ctx.db
    key_email, key_ip = f"email:{email}", (f"ip:{ctx.ip}" if ctx.ip else None)
    if security.is_locked(db, key_email) or (key_ip and security.is_locked(db, key_ip)):
        raise TooManyRequests("Troppi tentativi falliti. Riprova tra qualche minuto.")
    user = db.execute("SELECT * FROM users WHERE email = ? AND active = 1", (email,)).fetchone()
    if user is None or not security.verify_secret(auth_hash or "", user["auth_hash"]):
        security.register_failure(db, key_email, config.MAX_FAILED_LOGINS, config.LOCK_SECONDS)
        if key_ip:
            security.register_failure(db, key_ip, config.MAX_FAILED_PER_IP, config.IP_LOCK_SECONDS, config.IP_WINDOW_SECONDS)
        audit(ctx, "login_fallito", username=email)
        db.commit()
        raise Unauthorized("Email o password non corretti.")
    if user["must_change_pw"] and user["temp_expires_at"] and user["temp_expires_at"] < now():
        raise Unauthorized("La password temporanea è scaduta: chiedi all'amministratore di inviarne una nuova.",
                           code="temp_password_expired")
    security.reset_failures(db, key_email)
    security.purge_failures(db)
    security.purge_expired_sessions(db)
    token = security.create_session(db, user["id"], ctx.ip)
    ctx.user = dict(user)
    db.execute("UPDATE users SET last_login = ? WHERE id = ?", (now(), user["id"]))
    audit(ctx, "login")
    db.commit()
    return user_out(db, ctx.user), token


def logout(ctx, token: str):
    if ctx.user:
        audit(ctx, "logout")
    security.delete_session(ctx.db, token)
    ctx.db.commit()


def change_password(ctx, data: dict, token: str):
    """Cambio password con quella attuale.

    Il browser ri-cifra la chiave privata con la nuova password (l'accesso ai dati resta).
    Al primo accesso genera anche la coppia di chiavi; se è il primo amministratore
    crea anche le chiavi dell'archivio ('init_grants').
    """
    ctx.require_user()
    db, user = ctx.db, ctx.user
    if not security.verify_secret(data.get("current_auth_hash") or "", user["auth_hash"]):
        raise Invalid("La password attuale non è corretta.")
    new_hash = data.get("new_auth_hash")
    if not security.valid_auth_hash(new_hash):
        raise Invalid("Dati di accesso non validi.")
    if security.verify_secret(new_hash, user["auth_hash"]):
        raise Invalid("La nuova password deve essere diversa da quella attuale.")
    enc_private_key = check_b64(data.get("enc_private_key"), "chiave privata")

    public_key = user["public_key"]
    if public_key is None:  # primo accesso: nuova coppia di chiavi
        public_key = check_b64(data.get("public_key"), "chiave pubblica")
    elif data.get("public_key") and data["public_key"] != public_key:
        raise Invalid("La chiave pubblica non si può cambiare con il cambio password.")

    initialized = get_state(db, "keys_initialized") == "1"
    if data.get("init_grants"):
        if initialized or user["role"] != "admin":
            raise Forbidden("Le chiavi dell'archivio esistono già.")
        save_grants(db, user["id"], check_grants(data["init_grants"], need_identity=True), user["id"])
        set_state(db, "keys_initialized", "1")
        audit(ctx, "creazione_chiavi_archivio")
    elif not initialized and user["role"] == "admin":
        raise Invalid("Al primo accesso dell'amministratore vanno create le chiavi dell'archivio.")

    db.execute("""UPDATE users SET auth_hash = ?, public_key = ?, enc_private_key = ?, must_change_pw = 0,
                  temp_expires_at = NULL WHERE id = ?""", (security.hash_secret(new_hash), public_key, enc_private_key, user["id"]))
    security.delete_user_sessions(db, user["id"], except_token=token)
    audit(ctx, "cambio_password")
    db.commit()
    if user["email"] == config.SEED_ADMIN_EMAIL:
        remove_seed_password_file()     # la password iniziale non serve più
    ctx.user = dict(db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
    return user_out(db, ctx.user)
