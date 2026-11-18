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
from app.constants import DEFAULT_EXAMS, DEFAULT_PATHOLOGIES  # noqa: E402
from app import backup, migrations  # noqa: E402
from app.version import SCHEMA_VERSION  # noqa: E402


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
    admin.add_pathology(adm, "Patologia di prova")
    with pytest.raises(Conflict):
        admin.add_pathology(adm, "Patologia di prova")
    new_id = admin.add_exam_type(adm, {"name": "Esame di prova", "category": "Prove", "unit": "pg/mL",
                                       "code": "99.99.9", "aliases": "prova, test di prova|prova"})
    m = vault.meta(adm)
    assert any(p["name"] == "Patologia di prova" for p in m["pathologies"])
    assert len(m["exam_types"]) == len(DEFAULT_EXAMS) + 1
    t = next(t for t in m["exam_types"] if t["id"] == new_id)
    assert t["code"] == "99.99.9" and t["aliases"] == "prova|test di prova"
    tsh = next(t for t in m["exam_types"] if t["name"] == "TSH")
    assert tsh["code"] == "90.42.1" and "tireotropina" in tsh["aliases"]
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


def test_admin_deletes_patients_and_catalog_entries(env):
    adm = first_admin(env)
    uid = new_doctor(adm)
    doc, _, _ = login(env, "rossi@uniroma1.it", "temporanea123")
    doc.user["must_change_pw"] = 0
    p = vault.create_patient(adm, {"enc_identity": blob("id"), "enc_clinical": blob("c")})
    vault.add_exams(doc, p["id"], [blob("e1"), blob("e2")])
    vault.add_visit(doc, p["id"], blob("v"))
    # un medico non può eliminare pazienti né voci dei cataloghi
    with pytest.raises(Forbidden):
        vault.delete_patient(doc, p["id"])
    pid = env["db"].execute("SELECT id FROM pathologies LIMIT 1").fetchone()[0]
    tid = env["db"].execute("SELECT id FROM exam_types LIMIT 1").fetchone()[0]
    with pytest.raises(Forbidden):
        admin.delete_pathology(doc, pid)
    with pytest.raises(Forbidden):
        admin.delete_exam_type(doc, tid)
    # l'admin sì: il paziente sparisce con esami e visite
    vault.delete_patient(adm, p["id"])
    v = vault.get_vault(adm)
    assert v["patients"] == [] and v["exams"] == [] and v["visits"] == []
    with pytest.raises(NotFound):
        vault.delete_patient(adm, p["id"])
    admin.delete_pathology(adm, pid)
    admin.delete_exam_type(adm, tid)
    m = vault.meta(adm)
    assert pid not in [x["id"] for x in m["pathologies"]] and tid not in [x["id"] for x in m["exam_types"]]
    actions = [r["action"] for r in admin.audit_log(adm)]
    assert {"elimina_paziente", "catalogo_elimina_patologia", "catalogo_elimina_esame"} <= set(actions)
    assert uid


def _make_v1_database(path):
    """Database come lo creava la versione 3.0 (schema v1, user_version 0) con un paziente e un esame."""
    import sqlite3 as sq
    con = sq.connect(path)
    con.executescript(open(os.path.join(os.path.dirname(__file__), "fixtures", "schema_v1.sql"), encoding="utf-8").read())
    con.executemany("INSERT INTO pathologies (name) VALUES (?)", [("Morbo di Addison",), ("CAH classica",)])
    con.executemany("INSERT INTO exam_types (category, name, unit) VALUES (?,?,?)",
                    [("Asse surrenalico", "ACTH", "pg/mL"), ("Metabolico", "Glicemia", "mg/dL"),
                     ("Personalizzati", "Esame aggiunto dall'admin", "")])
    con.execute("UPDATE exam_types SET active = 0 WHERE name = 'ACTH'")
    con.execute("INSERT INTO users (email, full_name, role, can_view_identity, must_change_pw, auth_hash) "
                "VALUES ('a@b.it', 'Admin', 'admin', 1, 0, 'x')")
    con.execute("INSERT INTO patients (code, enc_identity, enc_clinical, created_by) VALUES ('PZ-AAAAAA', 'v1.aWQ=', 'v1.Yw==', 1)")
    con.execute("INSERT INTO exams (patient_id, enc_data, created_by) VALUES (1, 'v1.ZXNhbWU=', 1)")
    con.commit()
    assert con.execute("PRAGMA user_version").fetchone()[0] == 0
    con.close()


def test_upgrade_from_v1_keeps_data_and_makes_backup(tmp_path, monkeypatch):
    db_path = str(tmp_path / "pazienti.db")
    monkeypatch.setattr(config, "DB_PATH", db_path)
    _make_v1_database(db_path)
    dbmod.init_db()
    con = dbmod.connect()
    assert migrations.schema_version(con) == SCHEMA_VERSION
    # dati intatti
    assert con.execute("SELECT code, enc_identity, enc_clinical FROM patients").fetchone()[:] == ("PZ-AAAAAA", "v1.aWQ=", "v1.Yw==")
    assert con.execute("SELECT enc_data FROM exams").fetchone()[0] == "v1.ZXNhbWU="
    assert con.execute("SELECT email FROM users").fetchone()[0] == "a@b.it"
    # cataloghi: voci esistenti conservate (anche disattivate e personalizzate), nuove aggiunte, sinonimi completati
    names = {r[0]: r for r in con.execute("SELECT name, active, code, aliases FROM exam_types")}
    assert names["ACTH"][1] == 0 and "Esame aggiunto dall'admin" in names
    assert names["Glicemia"][2] == "90.27.1" and "glucosio" in names["Glicemia"][3]
    assert len(names) == len(DEFAULT_EXAMS) + 1
    assert con.execute("SELECT COUNT(*) FROM pathologies").fetchone()[0] == len(DEFAULT_PATHOLOGIES)
    con.close()
    # backup creato prima della migrazione, con i dati originali
    saved = [f for f in os.listdir(backup.backup_dir()) if f.endswith("-pre-migrazione.db")]
    assert len(saved) == 1
    import sqlite3 as sq
    old = sq.connect(os.path.join(backup.backup_dir(), saved[0]))
    assert old.execute("PRAGMA user_version").fetchone()[0] == 0 and old.execute("SELECT COUNT(*) FROM patients").fetchone()[0] == 1
    old.close()
    # riavvio: nessuna nuova migrazione né nuovo backup
    dbmod.init_db()
    assert len([f for f in os.listdir(backup.backup_dir()) if "pre-migrazione" in f]) == 1


def test_newer_database_is_refused(tmp_path, monkeypatch):
    db_path = str(tmp_path / "pazienti.db")
    monkeypatch.setattr(config, "DB_PATH", db_path)
    dbmod.init_db()
    con = dbmod.connect()
    con.execute(f"PRAGMA user_version = {SCHEMA_VERSION + 1}")
    con.close()
    with pytest.raises(migrations.DatabaseTooNew):
        dbmod.init_db()


def test_legacy_data_folder_is_moved(tmp_path, monkeypatch):
    legacy = tmp_path / "progetto" / "backend" / "data"
    legacy.mkdir(parents=True)
    _make_v1_database(str(legacy / "pazienti.db"))
    (legacy / "server.log").write_text("log")
    target = tmp_path / "GestionePazienti-dati"
    monkeypatch.setattr(dbmod, "LEGACY_DATA_DIR", str(legacy))
    monkeypatch.setattr(config, "DB_PATH", str(target / "pazienti.db"))
    assert dbmod.move_legacy_data() == str(target)
    assert (target / "pazienti.db").exists() and not (legacy / "pazienti.db").exists()
    assert (legacy / "DATI-SPOSTATI.txt").exists() and (legacy / "server.log").exists()
    dbmod.init_db()                                     # e poi si aggiorna normalmente
    assert dbmod.connect().execute("SELECT COUNT(*) FROM patients").fetchone()[0] == 1
    # se nella nuova posizione c'è già un database non sposta nulla
    _make_v1_database(str(legacy / "pazienti.db"))
    assert dbmod.move_legacy_data() is None and (legacy / "pazienti.db").exists()


def test_daily_backup(env):
    first_admin(env)
    first = backup.daily_backup_if_due()
    assert first and os.path.exists(first)
    assert backup.daily_backup_if_due() is None             # già fatto oggi
    for i in range(35):                                     # se ne tengono al massimo 30
        backup.make_backup("giornaliero")
    assert len([f for f in os.listdir(backup.backup_dir()) if f.endswith("-giornaliero.db")]) <= 30


@pytest.mark.skipif(not __import__("app.services.ocr", fromlist=["x"]).available(), reason="Tesseract non installato")
def test_ocr_reads_photo_without_saving_it(env):
    import base64
    from app.services import ocr
    adm = first_admin(env)
    before = set(os.listdir(os.path.dirname(config.DB_PATH)))
    img = open(os.path.join(os.path.dirname(__file__), "fixtures", "foto-referto.jpg"), "rb").read()
    res = ocr.read_image(adm, base64.b64encode(img).decode())
    text = "\n".join(" ".join(i["str"] for i in line["items"]) for line in res["lines"])
    assert "Glicemia" in text and "RSSMTR80A41H501V" in text
    assert all({"x", "w", "str"} <= set(i) for line in res["lines"] for i in line["items"])
    assert set(os.listdir(os.path.dirname(config.DB_PATH))) == before          # nessun file scritto
    log = admin.audit_log(adm)[0]
    assert log["action"] == "ocr_documento" and "Glicemia" not in (log["details"] or "")   # mai il contenuto
    with pytest.raises(Invalid):
        ocr.read_image(adm, base64.b64encode(b"GIF89a....").decode())          # solo PNG/JPEG
    with pytest.raises(Invalid):
        ocr.read_image(adm, "non-base64!!")


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
