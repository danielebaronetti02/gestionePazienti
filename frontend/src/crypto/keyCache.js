// Chiavi conservate per la scheda del browser, così ricaricando la pagina non serve la password.
//
// - Le chiavi (privata personale + chiavi dell'archivio) sono salvate CIFRATE in sessionStorage:
//   valgono solo per questa scheda e spariscono quando la scheda si chiude.
// - Le cifra una chiave AES generata dal browser come NON ESPORTABILE e custodita in IndexedDB:
//   uno script non può leggerne i byte e portarla altrove.
// - Dopo il tempo di inattività (lo stesso della sessione sul server) la copia viene scartata.
import { fromB64, toB64 } from "./vaultCrypto";

const subtle = globalThis.crypto.subtle;
const DB_NAME = "gestione-pazienti";
const STORE = "chiavi";
const WRAP_ID = "chiave-di-sessione";
const SS_KEYS = "gp_chiavi";
const SS_ACTIVITY = "gp_ultima_attivita";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function wrapKey(create) {
  let key = await idb("readonly", (s) => s.get(WRAP_ID));
  if (!key && create) {
    key = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);  // non esportabile
    await idb("readwrite", (s) => s.put(key, WRAP_ID));
  }
  return key || null;
}

/** Registra l'ultima attività dell'utente (usata per la scadenza). */
export function touchActivity() {
  try {
    sessionStorage.setItem(SS_ACTIVITY, String(Date.now()));
  } catch { /* storage non disponibile */ }
}

export function lastActivity() {
  return Number(sessionStorage.getItem(SS_ACTIVITY) || 0);
}

/** Salva le chiavi dell'utente collegato, cifrate, per questa scheda. */
export async function saveKeys(userId, keys) {
  try {
    const raw = async (k) => (k ? toB64(await subtle.exportKey("raw", k)) : null);
    const bundle = {
      userId,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey ? toB64(await subtle.exportKey("pkcs8", keys.privateKey)) : null,
      clinical: await raw(keys.clinical),
      identity: await raw(keys.identity),
    };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, await wrapKey(true),
      new TextEncoder().encode(JSON.stringify(bundle))));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    sessionStorage.setItem(SS_KEYS, toB64(out));
    touchActivity();
  } catch (err) {
    console.warn("Chiavi non conservate per la scheda (alla ricarica servirà la password):", err);
  }
}

/** Recupera le chiavi se appartengono a userId e non è scaduto il tempo di inattività; altrimenti null. */
export async function loadKeys(userId, maxIdleMs) {
  try {
    const stored = sessionStorage.getItem(SS_KEYS);
    if (!stored || Date.now() - lastActivity() > maxIdleMs) {
      await clearKeys();
      return null;
    }
    const key = await wrapKey(false);
    if (!key) return null;
    const bytes = fromB64(stored);
    const plain = await subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    const b = JSON.parse(new TextDecoder().decode(plain));
    if (b.userId !== userId) {
      await clearKeys();
      return null;
    }
    const aes = (v) => (v ? subtle.importKey("raw", fromB64(v), { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]) : null);
    return {
      publicKey: b.publicKey,
      privateKey: b.privateKey
        ? await subtle.importKey("pkcs8", fromB64(b.privateKey), { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])
        : null,
      clinical: await aes(b.clinical),
      identity: await aes(b.identity),
    };
  } catch {
    await clearKeys();
    return null;
  }
}

/** Cancella la copia delle chiavi (uscita, scadenza, sessione chiusa dal server). */
export async function clearKeys() {
  try {
    sessionStorage.removeItem(SS_KEYS);
    sessionStorage.removeItem(SS_ACTIVITY);
    await idb("readwrite", (s) => s.delete(WRAP_ID));
  } catch { /* niente da cancellare */ }
}
