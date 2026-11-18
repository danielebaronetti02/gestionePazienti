// Archivio cifrato lato browser: apertura delle chiavi, caricamento/decifratura, salvataggio cifrato.
import { api } from "./api";
import {
  decryptJSON, deriveCredentials, encryptJSON, generateDataKey, generateUserKeys, grantsFor,
  protectPrivateKey, randomPassword, taxCodeIndex, unlockPrivateKey, unwrapDataKey,
} from "./crypto/vaultCrypto";

export class WrongPassword extends Error {}

// ---------------------------------------------------------------------------
// Chiavi
// ---------------------------------------------------------------------------

/** Apre chiave privata e chiavi dell'archivio dell'utente collegato. */
export async function openKeys(kek) {
  const km = await api.get("/api/auth/keys");
  if (!km.enc_private_key) return { privateKey: null, publicKey: null, clinical: null, identity: null };
  let privateKey;
  try {
    privateKey = await unlockPrivateKey(km.enc_private_key, kek);
  } catch {
    throw new WrongPassword("Password non corretta.");
  }
  const clinical = km.grants.clinical ? await unwrapDataKey(km.grants.clinical, privateKey) : null;
  const identity = km.grants.identity ? await unwrapDataKey(km.grants.identity, privateKey) : null;
  return { privateKey, publicKey: km.public_key, clinical, identity };
}

/** Ricontrolla le chiavi concesse (es. dopo che un admin le ha concesse) senza chiedere la password. */
export async function refreshGrants(privateKey) {
  const km = await api.get("/api/auth/keys");
  return {
    privateKey, publicKey: km.public_key,
    clinical: km.grants.clinical ? await unwrapDataKey(km.grants.clinical, privateKey) : null,
    identity: km.grants.identity ? await unwrapDataKey(km.grants.identity, privateKey) : null,
  };
}

/** Login: deriva le credenziali, accede, apre le chiavi. */
export async function loginWithPassword(cfg, email, password) {
  const { authHash, kek } = await deriveCredentials(email, password, cfg);
  const user = await api.post("/api/auth/login", { email, auth_hash: authHash });
  const keys = await openKeys(kek);
  return { user, keys };
}

/** Sblocco dopo un ricaricamento della pagina (sessione ancora valida, chiavi non in memoria). */
export async function unlockWithPassword(cfg, user, password) {
  const { kek } = await deriveCredentials(user.email, password, cfg);
  return openKeys(kek);
}

/**
 * Cambio password. Mantiene la chiave privata (ri-protetta con la nuova password);
 * al primo accesso la genera; il primo amministratore crea anche le chiavi dell'archivio.
 */
export async function changePassword(cfg, user, current, next) {
  const cur = await deriveCredentials(user.email, current, cfg);
  const nxt = await deriveCredentials(user.email, next, cfg);
  const km = await api.get("/api/auth/keys");
  const body = { current_auth_hash: cur.authHash, new_auth_hash: nxt.authHash };
  let privateKey;
  if (km.enc_private_key) {
    try {
      privateKey = await unlockPrivateKey(km.enc_private_key, cur.kek);
    } catch {
      throw new WrongPassword("La password attuale non è corretta.");
    }
    body.enc_private_key = await protectPrivateKey(privateKey, nxt.kek);
  } else {
    const generated = await generateUserKeys(nxt.kek);
    privateKey = generated.privateKey;
    body.public_key = generated.publicKey;
    body.enc_private_key = generated.encPrivateKey;
    if (user.is_admin && !user.keys_initialized) {
      const clinical = await generateDataKey();
      const identity = await generateDataKey();
      body.init_grants = await grantsFor(generated.publicKey, { clinical, identity }, true);
    }
  }
  const updated = await api.post("/api/auth/password", body);
  return { user: updated, keys: await openKeys(nxt.kek) };
}

/**
 * Materiale per un account preparato dal browser dell'admin: password temporanea casuale,
 * chiavi protette da essa e chiavi dell'archivio avvolte per il nuovo utente.
 * La password temporanea NON va al server: la vede solo l'admin, che la comunica all'utente.
 */
export async function credentialsForUser(cfg, keys, email, withIdentity) {
  const tempPassword = randomPassword();
  const { authHash, kek } = await deriveCredentials(email, tempPassword, cfg);
  const k = await generateUserKeys(kek);
  const material = { auth_hash: authHash, public_key: k.publicKey, enc_private_key: k.encPrivateKey,
                     grants: await grantsFor(k.publicKey, keys, withIdentity) };
  return { material, tempPassword };
}

export { grantsFor };

// ---------------------------------------------------------------------------
// Archivio
// ---------------------------------------------------------------------------
async function safeDecrypt(key, blob) {
  if (!blob || !key) return null;
  try {
    return await decryptJSON(key, blob);
  } catch {
    return undefined; // non decifrabile
  }
}

/** Scarica e decifra tutto l'archivio. I record non decifrabili sono marcati con error: true. */
export async function loadVault(keys, opening = false) {
  const raw = await api.get("/api/vault", opening ? { opening: "true" } : undefined);
  const patients = await Promise.all(raw.patients.map(async (p) => {
    const clinical = await safeDecrypt(keys.clinical, p.enc_clinical);
    const identity = await safeDecrypt(keys.identity, p.enc_identity);
    return {
      id: p.id, code: p.code, created_at: p.created_at, updated_at: p.updated_at,
      created_by: p.created_by, updated_by: p.updated_by,
      clinical: clinical || { archived: false }, identity: identity || null,
      error: clinical === undefined || identity === undefined,
    };
  }));
  const exams = await Promise.all(raw.exams.map(async (e) => {
    const data = await safeDecrypt(keys.clinical, e.enc_data);
    return { id: e.id, patient_id: e.patient_id, created_at: e.created_at, created_by: e.created_by,
             updated_at: e.updated_at, updated_by: e.updated_by, ...(data || { status: "da_effettuare" }), error: !data };
  }));
  const visits = await Promise.all(raw.visits.map(async (v) => {
    const data = await safeDecrypt(keys.clinical, v.enc_data);
    return { id: v.id, patient_id: v.patient_id, created_at: v.created_at, created_by: v.created_by,
             ...(data || {}), error: !data };
  }));
  return {
    patients, exams, visits,
    patientsById: new Map(patients.map((p) => [p.id, p])),
    patientsByCode: new Map(patients.map((p) => [p.code, p])),
  };
}

// ---------------------------------------------------------------------------
// Salvataggi (sempre cifrati prima dell'invio)
// ---------------------------------------------------------------------------
const CLINICAL_FIELDS = ["sex", "pathology_id", "diagnosis_date", "notes", "archived"];
const EXAM_FIELDS = ["exam_type_id", "prescribed_date", "expected_date", "delivered_date", "result_date",
                     "status", "result_value", "result_unit", "reference_range", "out_of_range", "notes", "source"];
const pick = (obj, fields) => Object.fromEntries(fields.map((f) => [f, obj[f] ?? null]));

export async function createPatient(keys, identity, clinical) {
  return api.post("/api/patients", {
    enc_identity: await encryptJSON(keys.identity, identity),
    enc_clinical: await encryptJSON(keys.clinical, pick({ archived: false, ...clinical }, CLINICAL_FIELDS)),
    tax_code_idx: await taxCodeIndex(keys.identity, identity.tax_code),
  });
}

/** identity = null → anagrafica invariata (es. utente senza permesso). */
export async function updatePatient(keys, patientId, clinical, identity = null, auditAction = null) {
  const body = { enc_clinical: await encryptJSON(keys.clinical, pick(clinical, CLINICAL_FIELDS)), audit_action: auditAction };
  if (identity && keys.identity) {
    body.enc_identity = await encryptJSON(keys.identity, identity);
    body.tax_code_idx = await taxCodeIndex(keys.identity, identity.tax_code);
  }
  return api.put(`/api/patients/${patientId}`, body);
}

/** Solo amministratori: elimina il paziente con tutti i suoi esami e visite. */
export function deletePatient(patientId) {
  return api.del(`/api/patients/${patientId}`);
}

export async function addExams(keys, patientId, exams) {
  const items = await Promise.all(exams.map((e) => encryptJSON(keys.clinical, pick(e, EXAM_FIELDS))));
  return api.post(`/api/patients/${patientId}/exams`, { items });
}

export async function updateExam(keys, examId, exam) {
  return api.put(`/api/exams/${examId}`, { enc_data: await encryptJSON(keys.clinical, pick(exam, EXAM_FIELDS)) });
}

export async function addVisit(keys, patientId, visit) {
  return api.post(`/api/patients/${patientId}/visits`, {
    enc_data: await encryptJSON(keys.clinical, pick(visit, ["visit_date", "visit_type", "notes"])),
  });
}

export function logEvent(action, patientCode = null, details = null) {
  return api.post("/api/audit/event", { action, patient_code: patientCode, details }).catch(() => {});
}
