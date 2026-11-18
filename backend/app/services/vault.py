"""Archivio cifrato: il server conserva e restituisce i dati così come arrivano dal browser.

Non può leggerli: controlla solo permessi e formato, e tiene il registro degli accessi.
"""
import secrets

from ..constants import CODE_ALPHABET, CODE_LENGTH, CODE_PREFIX, ROLES, SEXES, STATUS, VISIT_TYPES
from ..errors import Conflict, Forbidden, Invalid, NotFound
from ..security import audit
from ..utils import now
from .common import check_blob, check_index

# Eventi che il browser può registrare (aperture e esportazioni avvengono lato client)
CLIENT_EVENTS = {"apertura_scheda", "apertura_scheda_con_anagrafica", "esportazione_excel",
                 "esportazione_excel_con_anagrafica", "ricerca_pazienti",
                 "importa_prescrizione", "importa_referto", "stampa_scheda"}


def meta(ctx) -> dict:
    ctx.require_user()
    db = ctx.db
    return {
        "statuses": STATUS, "roles": ROLES, "sexes": SEXES, "visit_types": VISIT_TYPES,
        "pathologies": [dict(r) for r in db.execute("SELECT id, name, active FROM pathologies ORDER BY name")],
        "exam_types": [dict(r) for r in db.execute("SELECT id, name, category, unit, active, code, aliases FROM exam_types ORDER BY category, name")],
        "users": [dict(r) for r in db.execute("SELECT id, full_name FROM users ORDER BY full_name")],
    }


def get_vault(ctx, opening=False) -> dict:
    """Tutto l'archivio cifrato. L'anagrafica cifrata viene inviata solo a chi ha il permesso."""
    ctx.require_user()
    db = ctx.db
    with_identity = ctx.can_view_identity
    patients = []
    for r in db.execute("SELECT * FROM patients ORDER BY id"):
        p = {k: r[k] for k in ("id", "code", "enc_clinical", "created_at", "created_by", "updated_at", "updated_by")}
        p["enc_identity"] = r["enc_identity"] if with_identity else None
        patients.append(p)
    exams = [dict(r) for r in db.execute(
        "SELECT id, patient_id, enc_data, created_at, created_by, updated_at, updated_by FROM exams ORDER BY id")]
    visits = [dict(r) for r in db.execute(
        "SELECT id, patient_id, enc_data, created_at, created_by FROM visits ORDER BY id")]
    if opening:
        audit(ctx, "apertura_archivio", details=f"{len(patients)} pazienti")
        db.commit()
    return {"patients": patients, "exams": exams, "visits": visits}


def _patient(db, patient_id):
    row = db.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if row is None:
        raise NotFound("Paziente non trovato.")
    return row


def _new_code(db) -> str:
    while True:
        code = CODE_PREFIX + "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        if not db.execute("SELECT 1 FROM patients WHERE code = ?", (code,)).fetchone():
            return code


def _check_duplicate(db, tax_idx, exclude_id=None):
    if tax_idx:
        dup = db.execute("SELECT code FROM patients WHERE tax_code_idx = ? AND id != ?",
                         (tax_idx, exclude_id or -1)).fetchone()
        if dup:
            raise Conflict(f"Esiste già un paziente con questo codice fiscale ({dup['code']}).")


# ---------------------------------------------------------------------------
# Pazienti
# ---------------------------------------------------------------------------
def create_patient(ctx, data: dict) -> dict:
    ctx.require_edit()
    ctx.require_identity()
    db = ctx.db
    enc_identity = check_blob(data.get("enc_identity"), "anagrafica")
    enc_clinical = check_blob(data.get("enc_clinical"), "dati clinici")
    tax_idx = check_index(data.get("tax_code_idx"))
    _check_duplicate(db, tax_idx)
    code = _new_code(db)
    ts = now()
    cur = db.execute("""INSERT INTO patients (code, enc_identity, enc_clinical, tax_code_idx, created_by, updated_at, updated_by)
                        VALUES (?,?,?,?,?,?,?)""", (code, enc_identity, enc_clinical, tax_idx, ctx.user["id"], ts, ctx.user["id"]))
    audit(ctx, "crea_paziente", code)
    db.commit()
    return {"id": cur.lastrowid, "code": code}


def update_patient(ctx, patient_id: int, data: dict):
    """Senza permesso anagrafica si aggiornano solo i dati clinici."""
    ctx.require_edit()
    db = ctx.db
    p = _patient(db, patient_id)
    fields = {"enc_clinical": check_blob(data.get("enc_clinical"), "dati clinici"),
              "updated_at": now(), "updated_by": ctx.user["id"]}
    if data.get("enc_identity") is not None:
        if not ctx.can_view_identity:
            raise Forbidden("Il tuo profilo non è abilitato ai dati anagrafici.")
        fields["enc_identity"] = check_blob(data["enc_identity"], "anagrafica")
        fields["tax_code_idx"] = check_index(data.get("tax_code_idx"))
        _check_duplicate(db, fields["tax_code_idx"], exclude_id=p["id"])
    sets = ", ".join(f"{k} = ?" for k in fields)
    db.execute(f"UPDATE patients SET {sets} WHERE id = ?", (*fields.values(), p["id"]))
    audit(ctx, data.get("audit_action") if data.get("audit_action") in ("archivia_paziente", "ripristina_paziente")
          else "modifica_paziente", p["code"])
    db.commit()


def _touch(db, patient_id, user_id):
    db.execute("UPDATE patients SET updated_at = ?, updated_by = ? WHERE id = ?", (now(), user_id, patient_id))


# ---------------------------------------------------------------------------
# Esami
# ---------------------------------------------------------------------------
def add_exams(ctx, patient_id: int, items: list) -> list:
    ctx.require_edit()
    db = ctx.db
    p = _patient(db, patient_id)
    if not items:
        raise Invalid("Seleziona almeno un esame.")
    if len(items) > 100:
        raise Invalid("Troppi esami in una volta.")
    blobs = [check_blob(b, "esame") for b in items]
    ts = now()
    ids = [db.execute("INSERT INTO exams (patient_id, enc_data, created_by, updated_at, updated_by) VALUES (?,?,?,?,?)",
                      (p["id"], b, ctx.user["id"], ts, ctx.user["id"])).lastrowid for b in blobs]
    _touch(db, p["id"], ctx.user["id"])
    audit(ctx, "prescrive_esami", p["code"], f"{len(ids)} esami")
    db.commit()
    return ids


def _exam(db, exam_id):
    row = db.execute("SELECT e.*, p.code FROM exams e JOIN patients p ON p.id = e.patient_id WHERE e.id = ?",
                     (exam_id,)).fetchone()
    if row is None:
        raise NotFound("Esame non trovato.")
    return row


def update_exam(ctx, exam_id: int, enc_data: str):
    ctx.require_edit()
    db = ctx.db
    e = _exam(db, exam_id)
    db.execute("UPDATE exams SET enc_data = ?, updated_at = ?, updated_by = ? WHERE id = ?",
               (check_blob(enc_data, "esame"), now(), ctx.user["id"], exam_id))
    _touch(db, e["patient_id"], ctx.user["id"])
    audit(ctx, "aggiorna_esame", e["code"])
    db.commit()


def delete_exam(ctx, exam_id: int):
    ctx.require_edit()
    db = ctx.db
    e = _exam(db, exam_id)
    db.execute("DELETE FROM exams WHERE id = ?", (exam_id,))
    audit(ctx, "elimina_esame", e["code"])
    db.commit()


def delete_patient(ctx, patient_id: int):
    """Solo admin: elimina il paziente con tutti i suoi esami e visite (a cascata)."""
    ctx.require_admin()
    db = ctx.db
    p = db.execute("SELECT code FROM patients WHERE id = ?", (patient_id,)).fetchone()
    if p is None:
        raise NotFound("Paziente non trovato.")
    n_exams = db.execute("SELECT COUNT(*) FROM exams WHERE patient_id = ?", (patient_id,)).fetchone()[0]
    n_visits = db.execute("SELECT COUNT(*) FROM visits WHERE patient_id = ?", (patient_id,)).fetchone()[0]
    db.execute("DELETE FROM patients WHERE id = ?", (patient_id,))
    audit(ctx, "elimina_paziente", p["code"], details=f"{n_exams} esami, {n_visits} visite")
    db.commit()


# ---------------------------------------------------------------------------
# Visite
# ---------------------------------------------------------------------------
def add_visit(ctx, patient_id: int, enc_data: str) -> int:
    ctx.require_edit()
    db = ctx.db
    p = _patient(db, patient_id)
    vid = db.execute("INSERT INTO visits (patient_id, enc_data, created_by) VALUES (?,?,?)",
                     (p["id"], check_blob(enc_data, "visita"), ctx.user["id"])).lastrowid
    _touch(db, p["id"], ctx.user["id"])
    audit(ctx, "aggiunge_visita", p["code"])
    db.commit()
    return vid


def delete_visit(ctx, visit_id: int):
    """Solo chi ha registrato la visita o un amministratore."""
    ctx.require_edit()
    db = ctx.db
    v = db.execute("SELECT v.*, p.code FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.id = ?",
                   (visit_id,)).fetchone()
    if v is None:
        raise NotFound("Visita non trovata.")
    if not ctx.is_admin and v["created_by"] != ctx.user["id"]:
        raise Forbidden("Puoi eliminare solo le visite che hai registrato tu.")
    db.execute("DELETE FROM visits WHERE id = ?", (visit_id,))
    audit(ctx, "elimina_visita", v["code"])
    db.commit()


# ---------------------------------------------------------------------------
# Eventi registrati dal browser
# ---------------------------------------------------------------------------
def client_event(ctx, action: str, patient_code: str = None, details: str = None):
    ctx.require_user()
    if action not in CLIENT_EVENTS:
        raise Invalid("Evento non previsto.")
    if patient_code and not ctx.db.execute("SELECT 1 FROM patients WHERE code = ?", (patient_code,)).fetchone():
        raise NotFound("Paziente non trovato.")
    audit(ctx, action, patient_code, (details or "")[:200] or None)
    ctx.db.commit()
