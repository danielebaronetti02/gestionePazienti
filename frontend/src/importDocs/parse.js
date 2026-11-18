// Lettura di prescrizioni (promemoria della ricetta elettronica) e referti di laboratorio.
// Riceve le parole con la loro posizione orizzontale (dal PDF via pdf.js o dalla foto via OCR)
// e restituisce dati strutturati. Gira nel browser: nessun dato in chiaro va al server.
// Modulo senza dipendenze: è testato anche in Node (frontend/tests/import.test.mjs).

// ---------------------------------------------------------------------------
// Utilità
// ---------------------------------------------------------------------------
export function norm(text) {
  return (text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const DATE_RE = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/;
export function isoDate(text) {
  const m = DATE_RE.exec(text || "");
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// codice fiscale (anche con omocodia)
const CF_ODD = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
const cfVal = (c, odd) => {
  const d = /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
  return odd ? CF_ODD[d] : d;
};
/** Il 16° carattere del codice fiscale è un carattere di controllo: un codice letto male di solito non torna. */
export function taxCodeValid(cf) {
  if (!/^[A-Z0-9]{16}$/.test(cf || "")) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += cfVal(cf[i], i % 2 === 0);
  return String.fromCharCode(65 + (sum % 26)) === cf[15];
}

/** Quanti caratteri differiscono (codici della stessa lunghezza). */
export function charDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n += 1;
  return n;
}

/** Confronto tra i CF trovati nel documento e quello del paziente:
 *  "ok" uguale · "simile" letto male (non valido e quasi uguale) · "diverso" · "assente" */
export function compareTaxCode(found, patientCf) {
  if (!found.length) return "assente";
  if (found.includes(patientCf)) return "ok";
  if (found.some((cf) => !taxCodeValid(cf) && charDistance(cf, patientCf) <= 2)) return "simile";
  return "diverso";
}

const CF_RE = /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/g;

// ---------------------------------------------------------------------------
// Righe: raggruppa le parole per riga (stessa altezza) e le ordina da sinistra a destra
// ---------------------------------------------------------------------------
/** items: [{x, y, w, str}] (y cresce verso l'alto, come nei PDF). */
export function itemsToLines(items, tolerance = 2.5) {
  const sorted = items.filter((i) => i.str && i.str.trim())
    .map((i) => ({ x: i.x, y: i.y, w: i.w || 0, str: i.str }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tolerance);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map(finishLine);
}

function finishLine(line) {
  const items = [...line.items].sort((a, b) => a.x - b.x);
  let text = "";
  let end = null;
  for (const it of items) {
    if (end !== null) text += it.x - end > 1 ? " " : "";
    text += it.str;
    end = it.x + (it.w || it.str.length * 4);
  }
  return { y: line.y, items, text: text.replace(/\s+/g, " ").trim() };
}

/** Righe già raggruppate (es. dall'OCR): calcola solo il testo. */
export function prepareLines(lines) {
  return lines.map((l) => finishLine({ y: l.y ?? 0, items: l.items.filter((i) => i.str && i.str.trim()) }))
    .filter((l) => l.items.length);
}

// ---------------------------------------------------------------------------
// Tipo di documento
// ---------------------------------------------------------------------------
const PRESC_CODE_RE = /^(\d{2}\.\d{2}(?:\.\d{1,2})?)\s*(?:\((\d+)\))?\s*-\s*(.+)$/;
// riga di prestazione con il codice regionale illeggibile (foto) ma il codice ministeriale tra parentesi
const PRESC_LOOSE_RE = /^(\S{0,12})\s*\((\d{4,6})\)\s*-\s*(.+)$/;

export function detectKind(pages) {
  const text = pages.flat().map((l) => l.text).join("\n");
  if (/RICETTA ELETTRONICA|PROMEMORIA PER L.ASSISTITO|PRESCRIZIONE VALIDA/i.test(text)) return "prescrizione";
  if (pages.flat().filter((l) => PRESC_CODE_RE.test(l.text)).length >= 1 && /QUESITO|PRIORIT/i.test(text)) return "prescrizione";
  return "referto";
}

function taxCodes(text, exclude = []) {
  const all = [...new Set((text.toUpperCase().match(CF_RE) || []))];
  return all.filter((cf) => !exclude.includes(cf));
}

// ---------------------------------------------------------------------------
// Prescrizione (promemoria della ricetta dematerializzata)
// ---------------------------------------------------------------------------
const PRIORITY = {
  u: { label: "Urgente (entro 72 ore)", days: 3 },
  b: { label: "Breve (entro 10 giorni)", days: 10 },
  d: { label: "Differibile (entro 60 giorni)", days: 60 },
  p: { label: "Programmabile (entro 120 giorni)", days: 120 },
};
const ACCESS_RE = /^(PRIMO ACCESSO|ACCESSO SUCCESSIVO|ACCESSI SUCCESSIVI)\b/i;
const QTY_ONLY_RE = /^\d{1,2}\s+(---|\S{1,6})$/;
const STOP_RE = /^(QUESITO|N\.?\s*CONFEZIONI|CODICE AUTENTICAZIONE|TIPO RICETTA|Rilasciato ai sensi)/i;

export function parsePrescription(pages) {
  const lines = pages.flat();
  const text = lines.map((l) => l.text).join("\n");
  const find = (re) => (re.exec(text) || [])[1]?.trim() || null;

  const doctorCf = find(/CODICE FISCALE DEL MEDICO:\s*([A-Z0-9]{16})/i);
  const priorityWord = find(/PRIORIT\S*\s*PRESCRIZIONE[^:]*:\s*([A-Za-z]+)/i);
  const priority = priorityWord ? PRIORITY[priorityWord[0].toLowerCase()] : null;
  let nre = null;
  const nreM = /\b(\d{3}[A-Z]\d)\s+(\d{10})\b/.exec(text.replace(/\n/g, " "));
  if (nreM) nre = nreM[1] + nreM[2];

  const items = [];
  let current = null;
  for (const line of lines) {
    const t = line.text;
    if (STOP_RE.test(t)) { current = null; continue; }
    const m = PRESC_CODE_RE.exec(t) || PRESC_LOOSE_RE.exec(t);
    if (m) {
      const code = /^\d{2}\.\d{2}/.test(m[1]) ? m[1] : null;
      current = { code, ministerialCode: m[2] || null, description: cleanDescription(m[3]), access: null, quantity: null };
      const q = /\s(\d{1,2})\s+(---|\S{1,6})$/.exec(m[3]);
      if (q) current.quantity = Number(q[1]);
      items.push(current);
      continue;
    }
    if (!current) continue;
    if (ACCESS_RE.test(t)) { current.access = t.match(ACCESS_RE)[1]; continue; }
    if (QTY_ONLY_RE.test(t)) { current.quantity = Number(t.split(/\s+/)[0]); continue; }
    if (t.length < 80 && !/:/.test(t)) current.description = cleanDescription(`${current.description} ${t}`);
  }
  return {
    kind: "prescrizione",
    date: isoDate(find(/\bDATA:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)),
    doctor: find(/COGNOME E NOME DEL MEDICO:\s*(.+)/i),
    question: find(/QUESITO DIAGNOSTICO:\s*(.+)/i),
    priority,
    nre,
    taxCodes: taxCodes(text, doctorCf ? [doctorCf] : []),
    items,
  };
}

function cleanDescription(d) {
  return d.replace(/\s+\d{1,2}\s+(---|\S{1,6})\s*$/, "").replace(/\s*\[[A-Z]{1,2}\]/g, "")
    .replace(/[\s,;]+$/, "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Referto di laboratorio
// ---------------------------------------------------------------------------
const FOOTER_RE = /^(-\s*Il valore|Referto sottoscritto|La copia cartacea|Firmato digitalmente|Pag\.?\s*\d+\s*di|Il presente referto)/i;
const FLAG_RE = /^(\*+|[HL↑↓]|\+|-)$/;

function findHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    const t = norm(lines[i].text);
    if (/valore|risultato/.test(t) && /riferimento|intervallo|valorinormali|range/.test(t)) {
      const items = lines[i].items;
      const pick = (re) => items.find((it) => re.test(norm(it.str)));
      const name = pick(/^(esame|esami|analisi|prestazione|descrizione|test)/) || items[0];
      const value = pick(/^(valore|risultato|esito)/);
      const unit = pick(/^(um|unita|udm|unit)/);
      const range = pick(/^(intervallo|riferimento|valori|range)/);
      if (!value) continue;
      const center = (it) => (it ? it.x + (it.w || it.str.length * 5) / 2 : null);
      return {
        index: i, nameX: name.x, valueX: value.x,
        tol: Math.max(2, (value.x - name.x) / 50),        // ~4 punti nei PDF, in proporzione nelle foto
        centers: { value: center(value), unit: center(unit), range: center(range) },
      };
    }
  }
  return null;
}

/** Assegna le parole di una riga alle colonne del referto. */
function splitColumns(line, h) {
  const cells = { name: [], value: [], unit: [], range: [] };
  for (const it of line.items) {
    if (it.x < h.valueX - 3 * h.tol) { cells.name.push(it); continue; }
    const c = it.x + (it.w || it.str.length * 5) / 2;
    let best = "value";
    let dist = Infinity;
    for (const [col, x] of Object.entries(h.centers)) {
      if (x !== null && Math.abs(c - x) < dist) { dist = Math.abs(c - x); best = col; }
    }
    cells[best].push(it);
  }
  const join = (arr) => finishLine({ y: 0, items: arr }).text;
  return { name: join(cells.name), nameX: cells.name[0]?.x ?? null, value: join(cells.value), unit: join(cells.unit), range: join(cells.range) };
}

/** "F T 3" → "FT3", "Colesterolo H D L" → "Colesterolo HDL" (sigle scritte con le lettere spaziate) */
export function collapseSpaced(t) {
  return t.replace(/\b(?:[A-Za-z0-9] ){1,}[A-Za-z0-9]\b/g, (m) => m.replace(/ /g, ""));
}

const looksLikeRangeLine = (t) => t.length < 45 && (/:/.test(t) || /[<>≤≥]/.test(t) || /\d\s*-\s*\d/.test(t));
const isUpperTitle = (t) => /[A-Z]{3}/.test(t) && t === t.toUpperCase();

export function parseReport(pages) {
  const all = pages.flat();
  const text = all.map((l) => l.text).join("\n");
  const sampled = isoDate((/Data\s*(?:del\s*)?(?:prelievo|accettazione|raccolta)\s*:?\s*([\d/.-]{8,10})/i.exec(text) || [])[1]);
  const reported = isoDate((/Data\s*(?:del\s*)?(?:referto|refertazione|validazione|stampa)\s*:?\s*([\d/.-]{8,10})/i.exec(text) || [])[1]);
  const rows = [];
  const seenGroups = new Map();
  let section = null;
  let group = null;   // { name, x }
  let usedHeader = false;

  for (const pageLines of pages) {
    const h = findHeader(pageLines);
    if (!h) {
      for (const line of pageLines) {
        const r = parseFreeLine(line.text);
        if (r) rows.push({ ...r, section, group: null });
      }
      continue;
    }
    usedHeader = true;
    let last = null;
    for (const line of pageLines.slice(h.index + 1)) {
      if (FOOTER_RE.test(line.text)) break;
      const c = splitColumns(line, h);
      let flag = false;
      let value = c.value;
      const fm = /^(\*+)\s*(.*)$/.exec(value) || /^(.*?)\s+([HL↑↓*]+)$/.exec(value);
      if (fm) {
        if (/^\*+$/.test(fm[1])) { flag = true; value = fm[2]; } else if (FLAG_RE.test(fm[2])) { flag = true; value = fm[1]; }
      }
      let name = collapseSpaced(c.name.replace(/\s*\*+$/, () => { flag = true; return ""; }).trim());
      if (name && value) {
        if (group && c.nameX !== null && c.nameX <= group.x + h.tol) group = null;
        last = { section, group: group?.name || null, name, value: value.trim(), unit: c.unit, range: c.range, flag };
        rows.push(last);
      } else if (name && !value && !c.unit) {
        if (isUpperTitle(name)) { section = name; group = null; }
        else {
          if (group && c.nameX !== null && c.nameX <= group.x + h.tol) group = null;
          const key = `${section}|${norm(name)}`;
          group = seenGroups.get(key) || { name, x: c.nameX ?? 0 };
          seenGroups.set(key, group);
        }
        last = null;
      } else if (!name && value && last && !c.range) {
        last.value = `${last.value} ${value}`.trim();                 // valore su due righe
      } else if (!name && !value && c.range && last && last.range && looksLikeRangeLine(c.range)) {
        last.range = `${last.range}; ${c.range}`;                     // intervallo su più righe
      }
    }
  }
  for (const r of rows) {
    const bounds = parseRange(r.range);
    const num = parseNumber(r.value);
    r.numeric = num;
    r.outOfRange = r.flag ? true : (num !== null && bounds ? (bounds.min !== null && num < bounds.min) || (bounds.max !== null && num > bounds.max) : null);
  }
  return {
    kind: "referto", sampledDate: sampled, reportDate: reported || sampled, usedHeader,
    taxCodes: taxCodes(text), rows,
  };
}

/** Riga senza intestazione di colonne (es. foto storta): "Nome  12,3  mg/dl  10 - 20". */
function parseFreeLine(t) {
  const m = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .,'()/%-]{1,60}?)\s+(\*\s*)?([<>]?\s*\d+(?:[.,]\d+)?)\s*(\*)?\s*([A-Za-zµ%/^0-9.\\]{1,15})?\s*(.*)$/.exec(t);
  if (!m || /^(data|pag|tel|fax|cap|via|p\.?\s*iva|codice|richiesta|nata?|prog)/i.test(m[1])) return null;
  const range = m[6] || "";
  if (!m[5] && !range) return null;
  return { name: m[1].trim(), value: m[3].replace(/\s+/g, ""), unit: m[5] || "", range, flag: Boolean(m[2] || m[4]) };
}

export function parseNumber(v) {
  const m = /^[<>≤≥]?\s*(-?\d+(?:[.,]\d+)?)$/.exec(String(v || "").trim());
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

/** "74-109", "m.f. 82 - 98 fL", "< 4.5", "Livello desiderabile: <200" → {min, max}. */
export function parseRange(r) {
  let t = String(r || "").split(";")[0];
  if (t.includes(":")) t = t.split(":").slice(1).join(":");
  t = t.replace(/^\s*m\.?\s*f\.?\s*/i, "").replace(/(\d),(\d)/g, "$1.$2");
  let m = /(-?\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/.exec(t);
  if (m) return { min: parseFloat(m[1]), max: parseFloat(m[2]) };
  m = /[<≤]\s*=?\s*(\d+(?:\.\d+)?)/.exec(t);
  if (m) return { min: null, max: parseFloat(m[1]) };
  m = /[>≥]\s*=?\s*(\d+(?:\.\d+)?)/.exec(t);
  if (m) return { min: parseFloat(m[1]), max: null };
  return null;
}

// ---------------------------------------------------------------------------
// Abbinamento ai tipi di esame del catalogo (nome, sinonimi, codice nomenclatore)
// ---------------------------------------------------------------------------
function variants(text) {
  const t = String(text || "");
  const out = new Set([norm(t), norm(t.split("(")[0]), norm(t.split(":")[0]), norm(t.replace(/\(.*?\)/g, ""))]);
  for (const m of t.matchAll(/\(([^)]+)\)/g)) out.add(norm(m[1]));
  out.delete("");
  return [...out];
}

export function buildMatcher(examTypes) {
  const exact = new Map();
  const byCode = new Map();
  const keys = [];
  for (const t of examTypes.filter((x) => x.active !== 0 && x.active !== false)) {
    if (t.code) byCode.set(t.code.trim(), t);
    const words = [t.name, ...String(t.aliases || "").split("|")];
    for (const w of words) {
      for (const v of variants(w)) {
        if (v.length < 2 || exact.has(v)) continue;
        exact.set(v, t);
        keys.push([v, t]);
      }
    }
  }
  keys.sort((a, b) => b[0].length - a[0].length);
  return {
    /** { code, text, prefix } → tipo di esame o null */
    match({ code, text, prefix = false }) {
      if (code && byCode.has(code)) return byCode.get(code);
      const vs = variants(text);
      for (const v of vs) if (exact.has(v)) return exact.get(v);
      if (prefix) {
        const full = norm(text);
        for (const [k, t] of keys) if (k.length >= 5 && full.startsWith(k)) return t;
      }
      return null;
    },
  };
}

const sameUnit = (a, b) => norm(a).replace(/^u/, "") === norm(b).replace(/^u/, "");

/** Abbina le righe del referto ai tipi; i gruppi (es. "Esame delle urine") diventano un esame riassuntivo. */
export function matchReport(report, examTypes) {
  const m = buildMatcher(examTypes);
  const entries = report.rows.map((r) => ({ ...r, type: m.match({ text: r.name }) }));
  // stesso tipo su più righe (es. Eosinofili % e assoluti): tiene quella con l'unità del catalogo
  const byType = new Map();
  for (const e of entries.filter((x) => x.type)) {
    const prev = byType.get(e.type.id);
    if (!prev) { byType.set(e.type.id, e); continue; }
    const id = e.type.id;
    const better = sameUnit(e.unit, e.type.unit) && !sameUnit(prev.unit, prev.type.unit) ? e : prev;
    const worse = better === e ? prev : e;
    worse.type = null;
    byType.set(id, better);
  }
  const groups = [];
  const seen = new Set();
  for (const r of report.rows) {
    if (!r.group || seen.has(`${r.section}|${r.group}`)) continue;
    seen.add(`${r.section}|${r.group}`);
    const children = report.rows.filter((x) => x.group === r.group && x.section === r.section);
    const type = m.match({ text: r.group, prefix: true });
    if (!type || byType.has(type.id)) continue;             // già coperto da una riga con lo stesso tipo
    const summary = children.map((c) => `${c.name}: ${c.value}${c.unit ? ` ${c.unit}` : ""}${c.flag ? " *" : ""}`).join("; ");
    groups.push({ section: r.section, group: null, name: r.group, value: summary, unit: "", range: "", panel: true,
                  flag: children.some((c) => c.outOfRange), outOfRange: children.some((c) => c.outOfRange) ? true : null,
                  type, children: children.length });
    byType.set(type.id, groups[groups.length - 1]);
  }
  return [...groups, ...entries];
}

export function matchPrescription(presc, examTypes) {
  const m = buildMatcher(examTypes);
  return presc.items.map((it) => ({ ...it, type: m.match({ code: it.code, text: it.description, prefix: true }) }));
}
