// Formattazione all'italiana di date e numeri.

export function itDate(iso) {
  if (!iso) return "—";
  const [d] = String(iso).split(/[ T]/);
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return iso;
  return `${day}/${m}/${y}`;
}

export function itDateTime(iso) {
  if (!iso) return "—";
  const s = String(iso);
  if (s.length <= 10) return itDate(s);
  return `${itDate(s)} ${s.slice(11, 16)}`;
}

/** Numero con virgola decimale, senza zeri superflui (come nel backend). */
export function num(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "";
  const s = Math.abs(x) < 100 ? x.toFixed(2).replace(/\.?0+$/, "") : x.toFixed(0);
  return s.replace(".", ",");
}

export function age(birthIso) {
  if (!birthIso) return "";
  const b = new Date(birthIso + "T00:00:00");
  if (Number.isNaN(b.getTime())) return "";
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a -= 1;
  return a;
}

export function todayIso() {
  const t = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

/** Formato email valido (qualsiasi dominio). */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
