// Test della crittografia (Node 20+: stessa WebCrypto dei browser).
//   node tests/crypto.test.mjs [auth_hash_atteso_dal_backend]
import assert from "node:assert/strict";
import * as C from "../src/crypto/vaultCrypto.js";

const cfg = { kdf_iterations: Number(process.env.KDF_ITERATIONS || 600000), kdf_salt_prefix: "gestione-pazienti|" };
const t0 = Date.now();
const a = await C.deriveCredentials("Admin@UniRoma1.it ", "Cambiami-subito-2026", cfg);
console.log(`derivazione PBKDF2 (${cfg.kdf_iterations} iterazioni): ${Date.now() - t0} ms`);
if (process.argv[2]) assert.equal(a.authHash, process.argv[2], "auth_hash diverso da quello del backend");
assert.match(a.authHash, /^[A-Za-z0-9+/]{43}=$/);

// coppia di chiavi protetta dalla password
const user = await C.generateUserKeys(a.kek);
const priv = await C.unlockPrivateKey(user.encPrivateKey, a.kek);
const wrong = await C.deriveCredentials("admin@uniroma1.it", "password-sbagliata", cfg);
await assert.rejects(C.unlockPrivateKey(user.encPrivateKey, wrong.kek));

// chiavi dell'archivio avvolte per l'utente
const clinical = await C.generateDataKey();
const identity = await C.generateDataKey();
const grants = await C.grantsFor(user.publicKey, { clinical, identity }, true);
const clin2 = await C.unwrapDataKey(grants.clinical, priv);
const blob = await C.encryptJSON(clinical, { result_value: "14,2", notes: "à digiuno 😀" });
assert.ok(blob.startsWith("v1.") && !blob.includes("14,2"));
assert.deepEqual(await C.decryptJSON(clin2, blob), { result_value: "14,2", notes: "à digiuno 😀" });
await assert.rejects(C.decryptJSON(identity, blob));                       // chiave sbagliata
const tampered = blob.slice(0, -6) + (blob.slice(-6, -5) === "A" ? "B" : "A") + blob.slice(-5);
await assert.rejects(C.decryptJSON(clinical, tampered));                    // dato alterato

// secondo utente con solo la chiave clinica
const u2 = await C.generateUserKeys((await C.deriveCredentials("spec@uniroma1.it", "temporanea123", cfg)).kek);
const g2 = await C.grantsFor(u2.publicKey, { clinical, identity }, false);
assert.deepEqual(Object.keys(g2), ["clinical"]);

// cambio password: stessa chiave privata ri-protetta
const newCreds = await C.deriveCredentials("admin@uniroma1.it", "nuova-password-123", cfg);
const reEnc = await C.protectPrivateKey(priv, newCreds.kek);
const priv2 = await C.unlockPrivateKey(reEnc, newCreds.kek);
assert.ok(await C.unwrapDataKey(grants.identity, priv2));

// indice codice fiscale: stabile, normalizzato, dipende dalla chiave
const i1 = await C.taxCodeIndex(identity, "bnc mra 90e04 h501x");
assert.equal(i1, await C.taxCodeIndex(identity, "BNCMRA90E04H501X"));
assert.notEqual(i1, await C.taxCodeIndex(clinical, "BNCMRA90E04H501X"));
assert.equal(await C.taxCodeIndex(identity, ""), null);
console.log("TEST CRITTOGRAFIA OK");

// chiavi a curva ellittica: generazione rapida e password temporanea
const t1 = Date.now();
for (let i = 0; i < 5; i++) await C.generateUserKeys(a.kek);
console.log(`5 coppie di chiavi generate in ${Date.now() - t1} ms`);
const pw = C.randomPassword();
assert.equal(pw.length, 16);
assert.match(pw, /^[A-HJ-NP-Za-km-np-z2-9]+$/);
console.log("TEST ECDH E PASSWORD TEMPORANEA OK");
