"""Test delle API via HTTP (FastAPI TestClient): cookie di sessione, CSRF, permessi, flussi completi.

Il browser normalmente cifra i dati e deriva auth_hash dalla password; qui si usano
security.derive_auth_hash (identica) e blob cifrati fittizi.

    cd backend && python -m pytest tests
"""
import base64
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from app import config, security  # noqa: E402

CSRF = {config.CSRF_HEADER: config.CSRF_VALUE}
ADMIN = config.SEED_ADMIN_EMAIL


def blob(tag):
    return "v1." + base64.b64encode(f"cifrato-{tag}".encode()).decode()


def b64(tag):
    return base64.b64encode(f"chiave-{tag}".encode()).decode()


ah = security.derive_auth_hash


@pytest.fixture()
def client(monkeypatch):
    tmp = tempfile.mkdtemp()
    monkeypatch.setattr(config, "DB_PATH", os.path.join(tmp, "p.db"))
    monkeypatch.setattr(config, "KDF_ITERATIONS", 1000)
    security.reset_failures()
    from app.main import app
    with TestClient(app) as c:      # esegue l'avvio: tabelle, cataloghi, admin di seed
        c.headers.update(CSRF)
        yield c


def login(c, email, password):
    r = c.post("/api/auth/login", json={"email": email, "auth_hash": ah(email, password)})
    assert r.status_code == 200, r.text
    return r.json()


def setup_admin(c):
    login(c, ADMIN, config.SEED_ADMIN_PASSWORD)
    r = c.post("/api/auth/password", json={
        "current_auth_hash": ah(ADMIN, config.SEED_ADMIN_PASSWORD), "new_auth_hash": ah(ADMIN, "admin-nuova-123"),
        "public_key": b64("pub"), "enc_private_key": b64("priv"),
        "init_grants": {"clinical": b64("c"), "identity": b64("i")}})
    assert r.status_code == 200, r.text


def test_full_flow(client):
    c = client
    assert c.get("/api/public-config").json()["session_minutes"] == 5
    assert c.get("/api/vault").status_code == 401

    # CSRF: senza intestazione le richieste di modifica sono rifiutate
    r = c.post("/api/auth/login", json={"email": ADMIN, "auth_hash": ah(ADMIN, config.SEED_ADMIN_PASSWORD)},
               headers={config.CSRF_HEADER: ""})
    assert r.status_code == 403

    # admin di seed: deve cambiare password e creare le chiavi
    me = login(c, ADMIN, config.SEED_ADMIN_PASSWORD)
    assert me["must_change_pw"] and not me["keys_initialized"]
    r = c.get("/api/vault")
    assert r.status_code == 403 and r.json()["code"] == "must_change_password"
    setup_admin(c)
    me = c.get("/api/auth/me").json()
    assert me["has_access"] and me["keys_initialized"] and not me["must_change_pw"]
    assert set(c.get("/api/auth/keys").json()["grants"]) == {"clinical", "identity"}

    # dottori: qualsiasi email valida
    user = {"full_name": "Dr. Rossi", "role": "medico", "can_view_identity": True, "public_key": b64("p-rossi"),
            "enc_private_key": b64("k-rossi"), "grants": {"clinical": b64("gc"), "identity": b64("gi")}}
    r = c.post("/api/admin/users", json={**user, "email": "non-una-email", "auth_hash": ah("non-una-email", "temporanea12")})
    assert r.status_code == 400 and "non valido" in r.json()["detail"]
    r = c.post("/api/admin/users", json={**user, "email": "rossi@uniroma1.it", "auth_hash": ah("rossi@uniroma1.it", "temporanea12")})
    assert r.status_code == 201
    rossi_id = r.json()["id"]

    # archivio cifrato
    r = c.post("/api/patients", json={"enc_identity": blob("id"), "enc_clinical": blob("c"), "tax_code_idx": "b" * 64})
    assert r.status_code == 201
    pid, code = r.json()["id"], r.json()["code"]
    assert c.post("/api/patients", json={"enc_identity": blob("x"), "enc_clinical": blob("y"), "tax_code_idx": "b" * 64}).status_code == 409
    assert c.post("/api/patients", json={"enc_identity": "Mario Rossi", "enc_clinical": blob("c")}).status_code == 400
    ids = c.post(f"/api/patients/{pid}/exams", json={"items": [blob("e1"), blob("e2")]}).json()["ids"]
    assert c.put(f"/api/exams/{ids[0]}", json={"enc_data": blob("e1-bis")}).status_code == 200
    assert c.delete(f"/api/exams/{ids[1]}").status_code == 200
    assert c.post(f"/api/patients/{pid}/visits", json={"enc_data": blob("v")}).status_code == 201
    assert c.put(f"/api/patients/{pid}", json={"enc_clinical": blob("c2"), "audit_action": "archivia_paziente"}).status_code == 200
    v = c.get("/api/vault", params={"opening": "true"}).json()
    assert v["patients"][0]["enc_clinical"] == blob("c2") and [e["enc_data"] for e in v["exams"]] == [blob("e1-bis")]
    assert c.post("/api/audit/event", json={"action": "apertura_scheda", "patient_code": code}).status_code == 200
    assert c.post("/api/audit/event", json={"action": "inventata"}).status_code == 400
    assert c.get("/api/meta").json()["users"]

    # dottore: primo accesso con password temporanea
    c.post("/api/auth/logout")
    assert c.get("/api/auth/me").status_code == 401
    me = login(c, "rossi@uniroma1.it", "temporanea12")
    assert me["must_change_pw"] and me["has_access"]
    r = c.post("/api/auth/password", json={"current_auth_hash": ah("rossi@uniroma1.it", "temporanea12"),
                                          "new_auth_hash": ah("rossi@uniroma1.it", "personale123"),
                                          "enc_private_key": b64("k-rossi-2")})
    assert r.status_code == 200 and not r.json()["must_change_pw"]
    assert c.get("/api/admin/users").status_code == 403
    c.post("/api/auth/logout")

    # l'admin elimina l'utente
    login(c, ADMIN, "admin-nuova-123")
    assert c.delete(f"/api/admin/users/{rossi_id}").status_code == 200
    assert c.get(f"/api/admin/users/{rossi_id}").status_code == 404
    r = c.post("/api/auth/login", json={"email": "rossi@uniroma1.it", "auth_hash": ah("rossi@uniroma1.it", "personale123")})
    assert r.status_code == 401
    actions = {r["action"] for r in c.get("/api/admin/audit").json()}
    assert {"login", "crea_paziente", "apertura_archivio", "apertura_scheda", "elimina_utente", "archivia_paziente"} <= actions


def test_login_lockout(client):
    for _ in range(5):
        r = client.post("/api/auth/login", json={"email": ADMIN, "auth_hash": ah(ADMIN, "sbagliata")})
        assert r.status_code == 401
    r = client.post("/api/auth/login", json={"email": ADMIN, "auth_hash": ah(ADMIN, config.SEED_ADMIN_PASSWORD)})
    assert r.status_code == 429


def test_security_headers(client):
    r = client.get("/api/public-config")
    assert r.headers["X-Frame-Options"] == "DENY" and "default-src 'self'" in r.headers["Content-Security-Policy"]
