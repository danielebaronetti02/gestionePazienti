// Crittografia lato browser (WebCrypto). Il server non vede mai password, chiavi né dati in chiaro.
//
// Schema delle chiavi
//   password ──PBKDF2──► master ──HMAC "auth"──► auth_hash  (inviato al server per il login)
//                              └─HMAC "enc"───► kek        (resta nel browser)
//   kek cifra (AES-GCM) la chiave privata ECDH P-256 dell'utente, salvata cifrata sul server.
//   Le chiavi dell'archivio (AES-GCM 256): "clinical" per i dati clinici, "identity" per l'anagrafica,
//   sono "avvolte" per ogni utente autorizzato con la sua chiave pubblica (ECIES: ECDH effimero +
//   HKDF-SHA256 + AES-GCM). Le chiavi a curva ellittica si generano all'istante in tutti i browser.
//   Ogni record è cifrato come "v1." + base64(iv[12] || ciphertext+tag).
//
// La derivazione deve restare identica a backend/app/security.py (usata per l'admin di seed).

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" };
const WRAP_INFO = enc.encode("gestione-pazienti/wrap/v1");

// ---------------------------------------------------------------------------
// base64
// ---------------------------------------------------------------------------
export function toB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const concat = (a, b) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

async function hmac(keyBytes, message) {
  const key = await subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", key, enc.encode(message)));
}

// ---------------------------------------------------------------------------
// Dalla password: auth_hash (per il server) e kek (solo locale)
// ---------------------------------------------------------------------------
export async function deriveCredentials(email, password, cfg) {
  const salt = enc.encode(cfg.kdf_salt_prefix + email.trim().toLowerCase());
  const base = await subtle.importKey("raw", enc.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  const master = new Uint8Array(
    await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: cfg.kdf_iterations }, base, 256)
  );
  const authHash = toB64(await hmac(master, "auth"));
  const kek = await subtle.importKey("raw", await hmac(master, "enc"), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  master.fill(0);
  return { authHash, kek };
}

// ---------------------------------------------------------------------------
// Cifratura simmetrica (AES-GCM)
// ---------------------------------------------------------------------------
async function aesEncrypt(key, bytes) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return concat(iv, new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, bytes)));
}

async function aesDecrypt(key, bytes) {
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
}

export async function encryptJSON(key, obj) {
  return "v1." + toB64(await aesEncrypt(key, enc.encode(JSON.stringify(obj))));
}

export async function decryptJSON(key, blob) {
  if (!blob || !blob.startsWith("v1.")) throw new Error("Formato cifrato sconosciuto");
  return JSON.parse(dec.decode(await aesDecrypt(key, fromB64(blob.slice(3)))));
}

// ---------------------------------------------------------------------------
// Chiavi personali (ECDH P-256): la privata è protetta dalla password
// ---------------------------------------------------------------------------
export async function generateUserKeys(kek) {
  const pair = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const publicKey = toB64(await subtle.exportKey("spki", pair.publicKey));
  const encPrivateKey = await protectPrivateKey(pair.privateKey, kek);
  return { publicKey, encPrivateKey, privateKey: pair.privateKey };
}

export async function protectPrivateKey(privateKey, kek) {
  return toB64(await aesEncrypt(kek, new Uint8Array(await subtle.exportKey("pkcs8", privateKey))));
}

/** Apre la chiave privata con la kek. Fallisce se la password è sbagliata. */
export async function unlockPrivateKey(encPrivateKey, kek) {
  const pkcs8 = await aesDecrypt(kek, fromB64(encPrivateKey));
  return subtle.importKey("pkcs8", pkcs8, ECDH, true, ["deriveBits"]);
}

/** Chiave AES "di trasporto" da un accordo ECDH (HKDF-SHA256). */
async function wrappingKey(privateKey, publicKey, usage) {
  const shared = await subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const hkdf = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: WRAP_INFO },
    hkdf, { name: "AES-GCM", length: 256 }, false, [usage]);
}

// ---------------------------------------------------------------------------
// Chiavi dell'archivio
// ---------------------------------------------------------------------------
export function generateDataKey() {
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** Avvolge una chiave dell'archivio per il titolare di publicKeyB64: base64(pubEffimera[65] || iv || cifrato). */
export async function wrapForUser(dataKey, publicKeyB64) {
  const recipient = await subtle.importKey("spki", fromB64(publicKeyB64), ECDH, false, []);
  const eph = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const kw = await wrappingKey(eph.privateKey, recipient, "encrypt");
  const ephRaw = new Uint8Array(await subtle.exportKey("raw", eph.publicKey));
  const raw = new Uint8Array(await subtle.exportKey("raw", dataKey));
  const sealed = await aesEncrypt(kw, raw);
  raw.fill(0);
  return toB64(concat(ephRaw, sealed));
}

export async function unwrapDataKey(wrappedB64, privateKey) {
  const bytes = fromB64(wrappedB64);
  const ephPub = await subtle.importKey("raw", bytes.subarray(0, 65), ECDH, false, []);
  const kw = await wrappingKey(privateKey, ephPub, "decrypt");
  const raw = await aesDecrypt(kw, bytes.subarray(65));
  return subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

/** Avvolge le chiavi dell'archivio per un altro utente (clinica sempre, anagrafica se autorizzato). */
export async function grantsFor(publicKeyB64, keys, withIdentity) {
  const grants = { clinical: await wrapForUser(keys.clinical, publicKeyB64) };
  if (withIdentity) {
    if (!keys.identity) throw new Error("Non possiedi la chiave dell'anagrafica.");
    grants.identity = await wrapForUser(keys.identity, publicKeyB64);
  }
  return grants;
}

/** Password temporanea casuale: la vede solo l'amministratore, il server riceve solo il suo hash. */
export function randomPassword(length = 16) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const out = [];
  while (out.length < length) {
    const b = globalThis.crypto.getRandomValues(new Uint8Array(1))[0];
    if (b < 232) out.push(alphabet[b % alphabet.length]);   // 232 = 4 × 58: niente distorsione
  }
  return out.join("");
}

/** Indice del codice fiscale (HMAC con chiave derivata da quella dell'anagrafica): solo per i duplicati. */
export async function taxCodeIndex(identityKey, taxCode) {
  const norm = (taxCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!norm) return null;
  const raw = new Uint8Array(await subtle.exportKey("raw", identityKey));
  const idxKey = await hmac(raw, "indice-codice-fiscale");
  raw.fill(0);
  return [...(await hmac(idxKey, norm))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
