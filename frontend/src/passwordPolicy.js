// Regole per le password scelte dagli utenti. Si controllano qui nel browser:
// il server non vede mai la password (riceve solo un valore derivato), quindi non può verificarla.

// Parole troppo prevedibili (confrontate senza numeri né simboli, in minuscolo)
const COMMON = new Set([
  "password", "passwordpassword", "passw", "pass", "qwerty", "qwertyuiop", "asdfghjkl", "azerty", "abc", "abcdef",
  "abcdefghijkl", "admin", "administrator", "amministratore", "cambiami", "cambiamisubito", "benvenuto", "ciao",
  "ciaociao", "iloveyou", "tiamo", "ospedale", "policlinico", "umberto", "sapienza", "uniroma", "medico",
  "medicina", "dottore", "dottoressa", "paziente", "pazienti", "gestione", "gestionepazienti", "endocrinologia",
  "surrene", "addison", "juventus", "forzaroma", "roma", "lazio", "forzalazio", "napoli", "milan", "inter", "italia",
  "estate", "inverno", "primavera", "autunno", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre", "letmein", "welcome", "monkey", "dragon",
  "sunshine", "princess", "football", "computer", "internet", "segreto", "segreta", "nessuna",
]);

function classes(pw) {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
}

function isSequence(pw) {
  const s = pw.toLowerCase();
  for (const run of ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm"]) {
    if (run.includes(s) || run.split("").reverse().join("").includes(s)) return true;
  }
  return false;
}

/** Restituisce il problema della password (testo) oppure null se va bene. */
export function passwordProblem(minLen, pw, confirm, email) {
  if (pw.length < minLen) return `La password deve avere almeno ${minLen} caratteri.`;
  if (confirm !== undefined && pw !== confirm) return "Le due password non coincidono.";
  const lower = pw.toLowerCase();
  const letters = lower.replace(/[^a-zà-ù]/g, "");
  if (new Set(pw).size < 6) return "La password ha troppi caratteri ripetuti.";
  if (isSequence(pw) || /^\d+$/.test(pw)) return "La password è troppo semplice (sequenza o solo numeri).";
  if (COMMON.has(lower) || COMMON.has(letters) || letters.length < 3 && /^\d/.test(pw))
    return "La password è troppo comune: scegline una meno prevedibile.";
  const local = (email || "").split("@")[0].toLowerCase();
  const parts = local.split(/[^a-z0-9]+/).filter((p) => p.length >= 4);
  if (local.length >= 4 && (lower.includes(local) || parts.some((p) => lower.includes(p))))
    return "La password non deve contenere il tuo nome o la tua email.";
  if (pw.length < 16 && classes(pw) < 3)
    return "Usa almeno 3 tipi di caratteri tra minuscole, maiuscole, numeri e simboli, oppure una frase di almeno 16 caratteri.";
  return null;
}
