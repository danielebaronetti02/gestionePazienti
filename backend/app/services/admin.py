"""Amministrazione: account dei dottori (con le loro chiavi), cataloghi, registro accessi.

Il browser dell'amministratore genera una password temporanea casuale, la mostra
all'amministratore (che la consegna al collega), prepara con essa la coppia di chiavi
del nuovo utente e gli "avvolge" le chiavi dell'archivio. Al server arrivano solo
auth_hash e materiale cifrato: la password temporanea non lascia mai il browser.
"""
import datetime as dt
import sqlite3

from .. import config, security
from ..constants import ROLES
from ..errors import Conflict, Invalid, NotFound
from ..security import audit
from ..utils import now
from .common import check_b64, check_grants, save_grants

USER_FIELDS = """id, email, full_name, role, can_view_identity, active, must_change_pw, temp_expires_at,
                 public_key, created_at, last_login"""


def _user_out(db, r) -> dict:
    d = dict(r)
    granted = {g["key_name"] for g in db.execute("SELECT key_name FROM key_grants WHERE user_id = ?", (d["id"],))}
    for k in ("can_view_identity", "active", "must_change_pw"):
        d[k] = bool(d[k])
    d["role_label"] = ROLES[d["role"]]
    d["has_keys"] = d["public_key"] is not None
    d["granted"] = sorted(granted)
    d["temp_expired"] = bool(d["must_change_pw"] and d["temp_expires_at"] and d["temp_expires_at"] < now())
    return d


def _get(db, user_id):
    r = db.execute(f"SELECT {USER_FIELDS} FROM users WHERE id = ?", (user_id,)).fetchone()
    if r is None:
        raise NotFound("Utente non trovato.")
    return r


def list_users(ctx) -> list:
    ctx.require_admin()
    return [_user_out(ctx.db, r) for r in ctx.db.execute(f"SELECT {USER_FIELDS} FROM users ORDER BY active DESC, full_name")]


def get_user(ctx, user_id: int) -> dict:
    ctx.require_admin()
    return _user_out(ctx.db, _get(ctx.db, user_id))


def _profile(data: dict) -> dict:
    p = {"full_name": (data.get("full_name") or "").strip(),
         "role": data.get("role") if data.get("role") in ROLES else None,
         "can_view_identity": 1 if data.get("can_view_identity") else 0,
         "active": 1 if data.get("active", True) else 0}
    if not p["full_name"]:
        raise Invalid("Il nome e cognome è obbligatorio.")
    if p["role"] is None:
        raise Invalid("Ruolo non valido.")
    return p


def _temp_expiry() -> str:
    return (dt.datetime.now() + dt.timedelta(hours=config.TEMP_PASSWORD_HOURS)).strftime("%Y-%m-%d %H:%M:%S")


def _key_material(data: dict, need_identity: bool):
    if not security.valid_auth_hash(data.get("auth_hash")):
        raise Invalid("Dati di accesso non validi.")
    return (check_b64(data.get("public_key"), "chiave pubblica"),
            check_b64(data.get("enc_private_key"), "chiave privata"),
            check_grants(data.get("grants"), need_identity=need_identity))


def _other_active_admins(db, user_id) -> int:
    return db.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id != ?", (user_id,)).fetchone()[0]


def create_user(ctx, data: dict) -> int:
    """Nuovo account (es. un dottore) con password temporanea: le chiavi le prepara il browser dell'admin."""
    ctx.require_admin()
    db = ctx.db
    email = security.normalize_email(data.get("email"))
    problem = security.email_problem(email)
    if problem:
        raise Invalid(problem)
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        raise Conflict("Esiste già un account con questa email.")
    p = _profile(data)
    public_key, enc_private_key, grants = _key_material(data, bool(p["can_view_identity"]))
    cur = db.execute("""INSERT INTO users (email, full_name, role, can_view_identity, active, must_change_pw,
                            temp_expires_at, auth_hash, public_key, enc_private_key) VALUES (?,?,?,?,?,1,?,?,?,?)""",
                     (email, p["full_name"], p["role"], p["can_view_identity"], p["active"], _temp_expiry(),
                      security.hash_secret(data["auth_hash"]), public_key, enc_private_key))
    save_grants(db, cur.lastrowid, grants, ctx.user["id"])
    audit(ctx, "crea_utente", details=f"{email} ({p['role']})")
    db.commit()
    return cur.lastrowid


def update_user(ctx, user_id: int, data: dict):
    """Nome, ruolo, permesso anagrafica, attivazione. Concedere l'anagrafica richiede la chiave avvolta."""
    ctx.require_admin()
    db = ctx.db
    u = _get(db, user_id)
    p = _profile(data)
    if u["id"] == ctx.user["id"] and (p["role"] != "admin" or not p["active"] or not p["can_view_identity"]):
        raise Invalid("Non puoi togliere a te stesso il ruolo di amministratore, l'anagrafica o disattivarti.")
    if u["role"] == "admin" and (p["role"] != "admin" or not p["active"]) and not _other_active_admins(db, user_id):
        raise Invalid("Deve restare almeno un amministratore attivo.")
    granted = {g["key_name"] for g in db.execute("SELECT key_name FROM key_grants WHERE user_id = ?", (user_id,))}
    if p["can_view_identity"] and "identity" not in granted and "clinical" in granted:
        wrapped = (data.get("grants") or {}).get("identity")
        save_grants(db, user_id, {"identity": check_b64(wrapped, "chiave anagrafica")}, ctx.user["id"])
    if not p["can_view_identity"]:
        db.execute("DELETE FROM key_grants WHERE user_id = ? AND key_name = 'identity'", (user_id,))
    db.execute("UPDATE users SET full_name = ?, role = ?, can_view_identity = ?, active = ? WHERE id = ?",
               (p["full_name"], p["role"], p["can_view_identity"], p["active"], user_id))
    if not p["active"]:
        security.delete_user_sessions(db, user_id)
    audit(ctx, "modifica_utente",
          details=f"{u['email']} ({p['role']}, anagrafica={p['can_view_identity']}, attivo={p['active']})")
    db.commit()


def reset_user_password(ctx, user_id: int, data: dict):
    """Nuova password temporanea (generata e mostrata nel browser dell'admin), con chiavi nuove già abilitate."""
    ctx.require_admin()
    db = ctx.db
    u = _get(db, user_id)
    if u["id"] == ctx.user["id"]:
        raise Invalid("Per la tua password usa «Cambia password».")
    public_key, enc_private_key, grants = _key_material(data, bool(u["can_view_identity"]))
    db.execute("""UPDATE users SET auth_hash = ?, public_key = ?, enc_private_key = ?, must_change_pw = 1,
                  temp_expires_at = ? WHERE id = ?""",
               (security.hash_secret(data["auth_hash"]), public_key, enc_private_key, _temp_expiry(), user_id))
    db.execute("DELETE FROM key_grants WHERE user_id = ?", (user_id,))
    save_grants(db, user_id, grants, ctx.user["id"])
    security.delete_user_sessions(db, user_id)
    audit(ctx, "reimposta_password_utente", details=u["email"])
    db.commit()


def delete_user(ctx, user_id: int):
    """Elimina un account. I dati che ha inserito restano (perdono solo il riferimento all'autore)."""
    ctx.require_admin()
    db = ctx.db
    u = _get(db, user_id)
    if u["id"] == ctx.user["id"]:
        raise Invalid("Non puoi eliminare il tuo account.")
    if u["role"] == "admin" and not _other_active_admins(db, user_id):
        raise Invalid("Deve restare almeno un amministratore attivo.")
    for table, cols in (("patients", ("created_by", "updated_by")), ("exams", ("created_by", "updated_by")),
                        ("visits", ("created_by",)), ("key_grants", ("granted_by",))):
        for col in cols:
            db.execute(f"UPDATE {table} SET {col} = NULL WHERE {col} = ?", (user_id,))
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))   # sessioni e chiavi concesse: eliminate a cascata
    audit(ctx, "elimina_utente", details=f"{u['email']} ({u['role']})")
    db.commit()


# ---------------------------------------------------------------------------
# Cataloghi
# ---------------------------------------------------------------------------
def catalogs(ctx) -> dict:
    ctx.require_admin()
    db = ctx.db
    return {"pathologies": [dict(r) for r in db.execute("SELECT * FROM pathologies ORDER BY name")],
            "exam_types": [dict(r) for r in db.execute("SELECT * FROM exam_types ORDER BY category, name")]}


def _insert_unique(db, sql, params):
    try:
        db.execute(sql, params)
    except sqlite3.IntegrityError:
        raise Conflict("Esiste già una voce con questo nome.") from None


def add_pathology(ctx, name: str):
    ctx.require_admin()
    name = (name or "").strip()
    if not name:
        raise Invalid("Nome patologia obbligatorio.")
    _insert_unique(ctx.db, "INSERT INTO pathologies (name) VALUES (?)", (name,))
    audit(ctx, "catalogo_aggiunge_patologia", details=name)
    ctx.db.commit()


def set_pathology_active(ctx, pathology_id: int, active: bool):
    ctx.require_admin()
    if ctx.db.execute("UPDATE pathologies SET active = ? WHERE id = ?", (int(active), pathology_id)).rowcount == 0:
        raise NotFound("Patologia non trovata.")
    ctx.db.commit()


def add_exam_type(ctx, data: dict):
    ctx.require_admin()
    name = (data.get("name") or "").strip()
    if not name:
        raise Invalid("Nome esame obbligatorio.")
    _insert_unique(ctx.db, "INSERT INTO exam_types (name, category, unit) VALUES (?,?,?)",
                   (name, (data.get("category") or "").strip() or "Altro", (data.get("unit") or "").strip() or None))
    audit(ctx, "catalogo_aggiunge_esame", details=name)
    ctx.db.commit()


def update_exam_type(ctx, type_id: int, data: dict):
    ctx.require_admin()
    row = ctx.db.execute("SELECT * FROM exam_types WHERE id = ?", (type_id,)).fetchone()
    if row is None:
        raise NotFound("Esame non trovato.")
    category = (data["category"].strip() or "Altro") if data.get("category") is not None else row["category"]
    unit = (data["unit"].strip() or None) if data.get("unit") is not None else row["unit"]
    active = int(data["active"]) if data.get("active") is not None else row["active"]
    ctx.db.execute("UPDATE exam_types SET category = ?, unit = ?, active = ? WHERE id = ?", (category, unit, active, type_id))
    ctx.db.commit()


def audit_log(ctx, q: str = "", limit: int = 500) -> list:
    ctx.require_admin()
    sql, params = "SELECT * FROM audit_log", []
    q = (q or "").strip()
    if q:
        sql += " WHERE username LIKE ? OR patient_code LIKE ? OR action LIKE ?"
        params = [f"%{q}%"] * 3
    return [dict(r) for r in ctx.db.execute(sql + " ORDER BY id DESC LIMIT ?", (*params, limit))]
