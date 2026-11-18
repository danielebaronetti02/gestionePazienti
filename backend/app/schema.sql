-- Schema "Gestione Pazienti" (SQLite) – archivio a conoscenza zero.
-- I dati dei pazienti sono salvati SOLO cifrati (colonne enc_*, formato "v1.<base64>"):
-- vengono cifrati e decifrati nel browser, il server non possiede le chiavi.
PRAGMA foreign_keys = ON;

-- Account del personale. auth_hash è derivato dalla password nel browser e qui
-- ri-cifrato con scrypt: la password non arriva mai al server.
CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name         TEXT NOT NULL,
    role              TEXT NOT NULL CHECK (role IN ('admin', 'medico', 'lettura')),
    can_view_identity INTEGER NOT NULL DEFAULT 0,
    active            INTEGER NOT NULL DEFAULT 1,
    must_change_pw    INTEGER NOT NULL DEFAULT 1,
    temp_expires_at   TEXT,            -- scadenza della password temporanea data dall'amministratore
    auth_hash         TEXT NOT NULL,
    public_key        TEXT,            -- chiave pubblica ECDH P-256 (SPKI, base64)
    enc_private_key   TEXT,            -- chiave privata cifrata con la password (solo il browser la apre)
    created_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_login        TEXT
);

-- Chiavi dell'archivio "avvolte" con la chiave pubblica di ciascun utente.
-- clinical = dati clinici; identity = anagrafica (solo per chi ha il permesso).
CREATE TABLE IF NOT EXISTS key_grants (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_name    TEXT NOT NULL CHECK (key_name IN ('clinical', 'identity')),
    wrapped_key TEXT NOT NULL,
    granted_by  INTEGER REFERENCES users(id),
    granted_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (user_id, key_name)
);

CREATE TABLE IF NOT EXISTS system_state (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Cataloghi (non contengono dati personali)
CREATE TABLE IF NOT EXISTS pathologies (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    name   TEXT NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS exam_types (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'Altro',
    unit     TEXT,
    active   INTEGER NOT NULL DEFAULT 1
);

-- Pazienti: in chiaro solo il codice pseudonimo; anagrafica e dati clinici cifrati
CREATE TABLE IF NOT EXISTS patients (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT NOT NULL UNIQUE,
    enc_identity TEXT,                -- chiave "identity": nome, CF, nascita, contatti
    enc_clinical TEXT NOT NULL,       -- chiave "clinical": sesso, patologia, diagnosi, note, archiviato
    tax_code_idx TEXT UNIQUE,         -- HMAC del codice fiscale calcolato nel browser (solo per i duplicati)
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by   INTEGER REFERENCES users(id),
    updated_at   TEXT,
    updated_by   INTEGER REFERENCES users(id)
);

-- Esami: tipo, date, stato, risultato e note tutti cifrati
CREATE TABLE IF NOT EXISTS exams (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    enc_data   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by INTEGER REFERENCES users(id),
    updated_at TEXT,
    updated_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_exams_patient ON exams(patient_id);

-- Visite: data, tipo e note cifrati
CREATE TABLE IF NOT EXISTS visits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    enc_data   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id);

-- Registro accessi (nessun dato clinico nei dettagli)
CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    user_id      INTEGER,
    username     TEXT,
    action       TEXT NOT NULL,
    patient_code TEXT,
    details      TEXT,
    ip           TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    last_seen  TEXT NOT NULL,
    ip         TEXT
);
