"""Test della logica del server su SQLite reale (senza server web).

Il server tratta i dati come blob cifrati opachi: qui si usano blob fittizi.
La crittografia vera è testata in frontend/tests/crypto.test.mjs.

    cd backend && python -m pytest tests
"""
import base64
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from app import config, db as dbmod, security  # noqa: E402
from app.context import Context  # noqa: E402
from app.errors import Conflict, Forbidden, Invalid, NotFound, TooManyRequests, Unauthorized  # noqa: E402
from app.services import admin, auth, vault  # noqa: E402


def blob(tag="x"):
    return "v1." + base64.b64encode(f"cifrato-{tag}".encode()).decode()


def b64(tag):
    return base64.b64encode(f"chiave-{tag}".encode()).decode()


def ah(email, password):
    return security.derive_auth_hash(email, password)


@pytest.fixture()
def env(monkeypatch):
    tmp = tempfile.mkdtemp()
    monkeypatch.setattr(config, "DB_PATH", os.path.join(tmp, "p.db"))
    monkeypatch.setattr(config, "KDF_ITERATIONS", 1000)   # più veloce nei test
    monkeypatch.setattr(config, "SEED_ADMIN_PASSWORD", None)   # password iniziale casuale, come in produzione
    assert dbmod.init_db() is True
    con = dbmod.connect()
    yield {"db": con, "tmp": tmp}
    con.close()


def login(env, email, password):
    ctx = Context(db=env["db"], ip="10.0.0.1")
    user, token = auth.login(ctx, email, ah(email, password))
    return ctx, user, token


def first_admin(env):
    """Seed → primo accesso → cambio password con creazione delle chiavi dell'archivio."""
    ctx, user, token = login(env, config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD)
    auth.change_password(ctx, {
        "current_auth_hash": ah(config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD),
        "new_auth_hash": ah(config.SEED_ADMIN_EMAIL, "nuova-password-admin"),
        "public_key": b64("pub-admin"), "enc_private_key": b64("priv-admin"),
        "init_grants": {"clinical": b64("w-clin"), "identity": b64("w-id")}}, token)
    return ctx


def new_doctor(adm, email="rossi@uniroma1.it", identity=True, role="medico", password="temporanea123"):
    data = {"email": email, "full_name": "Dott. " + email.split("@")[0], "role": role, "can_view_identity": identity,
            "auth_hash": ah(email, password), "public_key": b64("pub-" + email), "enc_private_key": b64("priv-" + email),
            "grants": {"clinical": b64("g1"), "identity": b64("g2") if identity else None}}
    return admin.create_user(adm, data)


# ---------------------------------------------------------------------------
def test_seed_admin_must_change_password_and_init_keys(env):
    ctx, user, token = login(env, "ADMIN@uniroma1.it", config.SEED_ADMIN_PASSWORD)
    assert user["is_admin"] and user["must_change_pw"] and not user["has_keys"] and not user["keys_initialized"]
    base = {"current_auth_hash": ah(config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD),
            "new_auth_hash": ah(config.SEED_ADMIN_EMAIL, "nuova-password-admin"), "enc_private_key": b64("p")}
    with pytest.raises(Invalid):                                   # serve la chiave pubblica
        auth.change_password(ctx, base, token)
    with pytest.raises(Invalid):                                   # serve creare le chiavi dell'archivio
        auth.change_password(ctx, dict(base, public_key=b64("pub")), token)
    out = auth.change_password(ctx, dict(base, public_key=b64("pub"),
                                         init_grants={"clinical": b64("c"), "identity": b64("i")}), token)
    assert not out["must_change_pw"] and out["has_access"] and out["keys_initialized"]
    km = auth.key_material(ctx)
    assert km["public_key"] == b64("pub") and set(km["grants"]) == {"clinical", "identity"}
    with pytest.raises(Unauthorized):
        login(env, config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD)
    assert login(env, config.SEED_ADMIN_EMAIL, "nuova-password-admin")[1]["has_access"]


def test_session_idle_timeout(env):
    assert config.SESSION_MINUTES == 5
    _, _, token = login(env, config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD)
    import datetime as dt
    recent = (dt.datetime.now() - dt.timedelta(minutes=4)).strftime("%Y-%m-%d %H:%M:%S")
    env["db"].execute("UPDATE sessions SET last_seen = ?", (recent,))
    env["db"].commit()
    assert security.user_from_session(env["db"], token) is not None           # 4 minuti: ancora valida
    old = (dt.datetime.now() - dt.timedelta(minutes=7)).strftime("%Y-%m-%d %H:%M:%S")
    env["db"].execute("UPDATE sessions SET last_seen = ?", (old,))
    env["db"].commit()
    assert security.user_from_session(env["db"], token) is None               # oltre il limite: chiusa


def test_login_lockout_and_wrong_password(env):
    for _ in range(5):
        with pytest.raises(Unauthorized):
            login(env, config.SEED_ADMIN_EMAIL, "sbagliata")
    with pytest.raises(TooManyRequests):
        login(env, config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD)
    # il blocco è nel database: resiste al riavvio del server (nuova connessione)
    env["db"].close()
    env["db"] = dbmod.connect()
    with pytest.raises(TooManyRequests):
        login(env, config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD)


def test_login_lockout_per_ip(env):
    # tanti account diversi dallo stesso IP: dopo 20 errori l'IP è bloccato, anche con la password giusta
    for i in range(config.MAX_FAILED_PER_IP):
        with pytest.raises(Unauthorized):
            login(env, f"tentativo{i}@esempio.it", "sbagliata")
    with pytest.raises(TooManyRequests):
        login(env, config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD)
    other = Context(db=env["db"], ip="10.0.0.99")     # da un altro PC si entra
    user, _ = auth.login(other, config.SEED_ADMIN_EMAIL, ah(config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD))
    assert user["email"] == config.SEED_ADMIN_EMAIL


def test_seed_password_is_random_and_file_removed_after_change(env):
    path = config.seed_password_file()
    assert os.path.exists(path)
    text = open(path, encoding="utf-8").read()
    assert config.SEED_ADMIN_PASSWORD in text and len(config.SEED_ADMIN_PASSWORD) == 23
    assert "Cambiami" not in config.SEED_ADMIN_PASSWORD
    first_admin(env)                                   # cambio password dell'admin iniziale
    assert not os.path.exists(path)


def test_admin_creates_doctors_any_valid_email(env):
    adm = first_admin(env)
    with pytest.raises(Invalid):
        new_doctor(adm, email="non-una-email")
    with pytest.raises(Invalid):
        new_doctor(adm, email="spazi @esempio.it")
    new_doctor(adm, email="Mario.Bianchi@Gmail.com")                   # qualsiasi dominio
    new_doctor(adm, email="bruno.2031580@studenti.uniroma1.it")
    assert login(env, "mario.bianchi@gmail.com", "temporanea123")[1]["must_change_pw"]
    uid = new_doctor(adm)
    with pytest.raises(Conflict):
        new_doctor(adm, email="ROSSI@uniroma1.it")               # stessa email, maiuscole diverse
    u = admin.get_user(adm, uid)
    assert u["must_change_pw"] and u["has_keys"] and u["granted"] == ["clinical", "identity"]
    assert "temporanea123" not in str([tuple(r) for r in env["db"].execute("SELECT * FROM users")])  # mai al server
    ctx, user, token = login(env, "rossi@uniroma1.it", "temporanea123")
    assert user["must_change_pw"] and user["has_access"]
    with pytest.raises(Forbidden):
        admin.list_users(ctx)


def test_doctor_without_identity_gets_only_clinical_key(env):
    adm = first_admin(env)
    new_doctor(adm, email="spec@uniroma1.it", identity=False, role="lettura")
    pid = vault.create_patient(adm, {"enc_identity": blob("id"), "enc_clinical": blob("clin")})["id"]
    ctx, user, _ = login(env, "spec@uniroma1.it", "temporanea123")
    ctx.user["must_change_pw"] = 0
    assert set(auth.key_material(ctx)["grants"]) == {"clinical"}
    v = vault.get_vault(ctx)
    assert v["patients"][0]["enc_identity"] is None and v["patients"][0]["enc_clinical"] == blob("clin")
    with pytest.raises(Forbidden):
        vault.update_patient(ctx, pid, {"enc_clinical": blob("y")})


def test_vault_crud_permissions_and_duplicates(env):
    adm = first_admin(env)
    idx = "a" * 64
    p = vault.create_patient(adm, {"enc_identity": blob("id"), "enc_clinical": blob("c"), "tax_code_idx": idx})
    assert p["code"].startswith("PZ-")
    with pytest.raises(Conflict):
        vault.create_patient(adm, {"enc_identity": blob("id2"), "enc_clinical": blob("c2"), "tax_code_idx": idx})
    with pytest.raises(Invalid):
        vault.create_patient(adm, {"enc_identity": "Mario Rossi in chiaro", "enc_clinical": blob("c")})
    ids = vault.add_exams(adm, p["id"], [blob("e1"), blob("e2")])
    vault.update_exam(adm, ids[0], blob("e1-risultato"))
    vault.delete_exam(adm, ids[1])
    vid = vault.add_visit(adm, p["id"], blob("v"))
    v = vault.get_vault(adm, opening=True)
    assert [e["enc_data"] for e in v["exams"]] == [blob("e1-risultato")] and len(v["visits"]) == 1
    vault.update_patient(adm, p["id"], {"enc_clinical": blob("archiviato"), "audit_action": "archivia_paziente"})

    new_doctor(adm, email="bianchi@uniroma1.it")
    doc, _, _ = login(env, "bianchi@uniroma1.it", "temporanea123")
    with pytest.raises(Forbidden):
        vault.delete_visit(doc, vid)                                   # solo autore o admin
    vault.delete_visit(adm, vid)
    vault.client_event(adm, "apertura_scheda_con_anagrafica", p["code"])
    with pytest.raises(Invalid):
        vault.client_event(adm, "azione_inventata")
    actions = [r["action"] for r in admin.audit_log(adm)]
    for a in ("crea_paziente", "prescrive_esami", "aggiorna_esame", "elimina_esame", "archivia_paziente",
              "apertura_archivio", "apertura_scheda_con_anagrafica", "elimina_visita"):
        assert a in actions, a


def test_admin_deletes_users(env):
    adm = first_admin(env)
    uid = new_doctor(adm)
    doc, _, _ = login(env, "rossi@uniroma1.it", "temporanea123")
    doc.user["must_change_pw"] = 0
    p = vault.create_patient(adm, {"enc_identity": blob("id"), "enc_clinical": blob("c")})
    vault.add_exams(doc, p["id"], [blob("e")])
    vault.add_visit(doc, p["id"], blob("v"))
    with pytest.raises(Forbidden):
        admin.delete_user(doc, adm.user["id"])                      # solo gli admin
    with pytest.raises(Invalid):
        admin.delete_user(adm, adm.user["id"])                      # non se stessi
    admin.delete_user(adm, uid)
    with pytest.raises(NotFound):
        admin.get_user(adm, uid)
    with pytest.raises(Unauthorized):
        login(env, "rossi@uniroma1.it", "temporanea123")
    v = vault.get_vault(adm)                                         # i dati inseriti restano
    assert len(v["exams"]) == 1 and len(v["visits"]) == 1 and v["exams"][0]["created_by"] is None
    assert "elimina_utente" in [r["action"] for r in admin.audit_log(adm)]
    # deve restare almeno un amministratore attivo
    uid2 = new_doctor(adm, email="admin2@uniroma1.it", role="admin")
    admin.delete_user(adm, uid2)
    with pytest.raises(Invalid):
        admin.update_user(adm, adm.user["id"], {"full_name": "A", "role": "medico", "can_view_identity": True})


def test_admin_updates_and_resets_users(env):
    adm = first_admin(env)
    uid = new_doctor(adm, identity=False)
    with pytest.raises(Invalid):                                       # concedere l'anagrafica richiede la chiave
        admin.update_user(adm, uid, {"full_name": "Dott. Rossi", "role": "medico", "can_view_identity": True})
    admin.update_user(adm, uid, {"full_name": "Dott. Rossi", "role": "medico", "can_view_identity": True,
                                 "grants": {"identity": b64("id")}})
    assert admin.get_user(adm, uid)["granted"] == ["clinical", "identity"]
    admin.update_user(adm, uid, {"full_name": "Dott. Rossi", "role": "medico", "can_view_identity": False})
    assert admin.get_user(adm, uid)["granted"] == ["clinical"]
    with pytest.raises(Invalid):
        admin.update_user(adm, adm.user["id"], {"full_name": "A", "role": "medico", "can_view_identity": True})
    admin.reset_user_password(adm, uid, {"auth_hash": ah("rossi@uniroma1.it", "temp-nuova-12"), "public_key": b64("p2"),
                                         "enc_private_key": b64("k2"), "grants": {"clinical": b64("c2")}})
    assert login(env, "rossi@uniroma1.it", "temp-nuova-12")[1]["must_change_pw"]
    admin.update_user(adm, uid, {"full_name": "Dott. Rossi", "role": "medico", "active": False})
    with pytest.raises(Unauthorized):
        login(env, "rossi@uniroma1.it", "temp-nuova-12")


def test_catalogs_and_meta(env):
    adm = first_admin(env)
    admin.add_pathology(adm, "Feocromocitoma")
    with pytest.raises(Conflict):
        admin.add_pathology(adm, "Feocromocitoma")
    admin.add_exam_type(adm, {"name": "Metanefrine", "category": "Midollare", "unit": "pg/mL"})
    m = vault.meta(adm)
    assert any(p["name"] == "Feocromocitoma" for p in m["pathologies"]) and len(m["exam_types"]) == 17
    assert m["users"][0]["full_name"]


def test_no_plaintext_in_database(env):
    """Il server salva esattamente ciò che riceve: nessun campo clinico in chiaro nello schema."""
    adm = first_admin(env)
    vault.create_patient(adm, {"enc_identity": blob("id"), "enc_clinical": blob("c")})
    cols = {r["name"] for r in env["db"].execute("PRAGMA table_info(patients)")}
    assert cols == {"id", "code", "enc_identity", "enc_clinical", "tax_code_idx", "created_at", "created_by",
                    "updated_at", "updated_by"}
    assert {r["name"] for r in env["db"].execute("PRAGMA table_info(exams)")} == {
        "id", "patient_id", "enc_data", "created_at", "created_by", "updated_at", "updated_by"}


def test_temp_password_expiry(env):
    adm = first_admin(env)
    uid = new_doctor(adm, email="scade@uniroma1.it")
    env["db"].execute("UPDATE users SET temp_expires_at = '2000-01-01 00:00:00' WHERE id = ?", (uid,))
    env["db"].commit()
    assert admin.get_user(adm, uid)["temp_expired"]
    with pytest.raises(Unauthorized) as exc:
        login(env, "scade@uniroma1.it", "temporanea123")
    assert exc.value.code == "temp_password_expired"
    admin.reset_user_password(adm, uid, {"auth_hash": ah("scade@uniroma1.it", "nuova-temp-123"), "public_key": b64("p3"),
                                         "enc_private_key": b64("k3"), "grants": {"clinical": b64("c3"), "identity": b64("i3")}})
    ctx, user, token = login(env, "scade@uniroma1.it", "nuova-temp-123")
    assert user["must_change_pw"]
    auth.change_password(ctx, {"current_auth_hash": ah("scade@uniroma1.it", "nuova-temp-123"),
                               "new_auth_hash": ah("scade@uniroma1.it", "personale-456"), "enc_private_key": b64("k4")}, token)
    assert env["db"].execute("SELECT temp_expires_at FROM users WHERE id = ?", (uid,)).fetchone()[0] is None


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
