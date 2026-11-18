// Logica dell'applicazione eseguita nel browser sui dati decifrati:
// stato degli esami, ritardi, ricerca, filtri, dashboard, andamenti.
// (Il server non può farla: vede solo dati cifrati.)
import { todayIso } from "./format";

export const STATUS_ORDER = { da_effettuare: 0, consegnato: 1, risultato: 2 };

/** Fa avanzare lo stato in base ai dati inseriti e completa le date mancanti. */
export function resolveStatus(chosen, delivered, resultValue, resultDate) {
  let status = chosen in STATUS_ORDER ? chosen : "da_effettuare";
  const inferred = resultValue ? "risultato" : delivered ? "consegnato" : "da_effettuare";
  if (STATUS_ORDER[inferred] > STATUS_ORDER[status]) status = inferred;
  if (status === "consegnato" && !delivered) delivered = todayIso();
  if (status === "risultato" && !resultDate) resultDate = todayIso();
  return { status, delivered, resultDate };
}

/** Controlli sulle date di un esame. Restituisce un messaggio d'errore o null. */
export function examDateProblem(d) {
  if (!d.prescribed_date) return "Data prescrizione: campo obbligatorio.";
  if (d.expected_date && d.expected_date < d.prescribed_date) return "La data prevista non può precedere la prescrizione.";
  if (d.delivered_date && d.delivered_date < d.prescribed_date) return "La consegna non può precedere la prescrizione.";
  if (d.result_date && d.result_date < d.prescribed_date) return "Il risultato non può precedere la prescrizione.";
  return null;
}

export function isOverdue(exam) {
  return exam.status === "da_effettuare" && !!exam.expected_date && exam.expected_date < todayIso();
}

const NUM_RE = /[-+]?\d+(?:[.,]\d+)?/;

/** Valore numerico da un risultato testuale ("14,2", "<0.5", "18.3 µg/dL"). */
export function parseNumeric(value) {
  if (!value) return null;
  const m = String(value).match(NUM_RE);
  return m ? parseFloat(m[0].replace(",", ".")) : null;
}

export function normalize(text) {
  return (text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const patientName = (p) => (p.identity ? `${p.identity.last_name} ${p.identity.first_name}`.trim() : null);

// ---------------------------------------------------------------------------
// Viste derivate dall'archivio decifrato
// ---------------------------------------------------------------------------

/** Esame "arricchito" con nomi di tipo, paziente, patologia e medico, per le tabelle. */
export function examView(e, vault, meta) {
  const p = vault.patientsById.get(e.patient_id);
  const t = meta.examTypesById.get(e.exam_type_id) || {};
  return {
    ...e,
    patient_code: p?.code,
    patient_name: p ? patientName(p) : null,
    pathology: p ? meta.pathologiesById.get(p.clinical.pathology_id)?.name : null,
    archived: p?.clinical.archived,
    type_name: t.name || "Esame sconosciuto",
    category: t.category || "",
    result_unit: e.result_unit || t.unit || "",
    overdue: isOverdue(e),
    prescriber: meta.usersById.get(e.created_by)?.full_name,
  };
}

const byExpected = (a, b) =>
  (a.expected_date ? 0 : 1) - (b.expected_date ? 0 : 1) ||
  (a.expected_date || "").localeCompare(b.expected_date || "") ||
  (a.prescribed_date || "").localeCompare(b.prescribed_date || "");

export function filterExams(vault, meta, { status = "aperti", overdue = false, pathology = "", exam_type = "" }) {
  return vault.exams
    .map((e) => examView(e, vault, meta))
    .filter((e) => !e.archived && !e.error)
    .filter((e) => (status in STATUS_ORDER ? e.status === status : status === "aperti" ? e.status !== "risultato" : true))
    .filter((e) => !overdue || e.overdue)
    .filter((e) => !pathology || String(vault.patientsById.get(e.patient_id)?.clinical.pathology_id) === String(pathology))
    .filter((e) => !exam_type || String(e.exam_type_id) === String(exam_type))
    .sort(byExpected);
}

export function patientExams(vault, meta, patientId) {
  const order = { da_effettuare: 0, consegnato: 1, risultato: 2 };
  return vault.exams
    .filter((e) => e.patient_id === patientId)
    .map((e) => examView(e, vault, meta))
    .sort((a, b) => order[a.status] - order[b.status] || (b.prescribed_date || "").localeCompare(a.prescribed_date || "") || b.id - a.id);
}

export function patientVisits(vault, patientId) {
  return vault.visits
    .filter((v) => v.patient_id === patientId)
    .sort((a, b) => (b.visit_date || "").localeCompare(a.visit_date || "") || b.id - a.id);
}

export function listPatients(vault, meta, { q = "", pathology = "", archived = false }) {
  const needle = normalize(q);
  const rows = vault.patients
    .filter((p) => archived || !p.clinical.archived)
    .filter((p) => (pathology === "none" ? !p.clinical.pathology_id : !pathology || String(p.clinical.pathology_id) === String(pathology)))
    .filter((p) => {
      if (!needle) return true;
      let hay = normalize(p.code);
      if (p.identity) {
        const i = p.identity;
        hay += " " + normalize(i.last_name + i.first_name) + " " + normalize(i.first_name + i.last_name) + " " + normalize(i.tax_code);
      }
      return hay.includes(needle);
    })
    .map((p) => {
      const exams = vault.exams.filter((e) => e.patient_id === p.id);
      const visits = vault.visits.filter((v) => v.patient_id === p.id).map((v) => v.visit_date).filter(Boolean).sort();
      return {
        ...p,
        name: patientName(p),
        pathology: meta.pathologiesById.get(p.clinical.pathology_id)?.name,
        open_exams: exams.filter((e) => e.status !== "risultato").length,
        last_visit: visits[visits.length - 1] || null,
      };
    });
  return rows.sort((a, b) =>
    a.name !== null && b.name !== null ? normalize(a.name).localeCompare(normalize(b.name)) : (b.created_at || "").localeCompare(a.created_at || ""));
}

export function dashboard(vault, meta) {
  const active = vault.patients.filter((p) => !p.clinical.archived);
  const activeIds = new Set(active.map((p) => p.id));
  const exams = vault.exams.filter((e) => activeIds.has(e.patient_id) && !e.error).map((e) => examView(e, vault, meta));
  const counts = { da_effettuare: 0, consegnato: 0, risultato: 0 };
  exams.forEach((e) => (counts[e.status] = (counts[e.status] || 0) + 1));
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const groups = new Map();
  active.forEach((p) => {
    const id = p.clinical.pathology_id || null;
    const name = id ? meta.pathologiesById.get(id)?.name || "Sconosciuta" : "Non assegnata";
    const g = groups.get(id) || { id, name, count: 0 };
    g.count += 1;
    groups.set(id, g);
  });

  return {
    total_patients: active.length,
    archived_patients: vault.patients.length - active.length,
    exam_counts: counts,
    overdue: exams.filter((e) => e.overdue).length,
    recent_results: exams.filter((e) => e.status === "risultato" && e.result_date >= monthAgo).length,
    by_pathology: [...groups.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    to_do: exams.filter((e) => e.status === "da_effettuare").sort(byExpected).slice(0, 15),
    waiting: exams.filter((e) => e.status === "consegnato")
      .sort((a, b) => (a.delivered_date || "").localeCompare(b.delivered_date || "")).slice(0, 15),
    recent_patients: [...active]
      .sort((a, b) => (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || ""))
      .slice(0, 8)
      .map((p) => ({ code: p.code, name: patientName(p), pathology: meta.pathologiesById.get(p.clinical.pathology_id)?.name,
                     updated_at: p.updated_at || p.created_at })),
  };
}

/** Serie numeriche per tipo di esame (solo serie con almeno 2 valori). */
export function examTrends(vault, meta, patientId, examTypeId = null) {
  const series = new Map();
  vault.exams
    .filter((e) => e.patient_id === patientId && e.status === "risultato" && e.result_value)
    .filter((e) => examTypeId === null || e.exam_type_id === examTypeId)
    .forEach((e) => {
      const v = parseNumeric(e.result_value);
      if (v === null) return;
      const t = meta.examTypesById.get(e.exam_type_id) || {};
      const s = series.get(e.exam_type_id) || { exam_type_id: e.exam_type_id, name: t.name, category: t.category,
                                                  unit: e.result_unit || t.unit || "", points: [] };
      s.points.push({ date: e.result_date || e.delivered_date || e.prescribed_date, value: v, raw: e.result_value });
      series.set(e.exam_type_id, s);
    });
  return [...series.values()]
    .filter((s) => s.points.length >= 2)
    .sort((a, b) => (a.category || "").localeCompare(b.category || "") || (a.name || "").localeCompare(b.name || ""));
}

/** Indici per accesso veloce a cataloghi e utenti. */
export function indexMeta(meta) {
  return {
    ...meta,
    pathologiesById: new Map(meta.pathologies.map((p) => [p.id, p])),
    examTypesById: new Map(meta.exam_types.map((t) => [t.id, t])),
    usersById: new Map(meta.users.map((u) => [u.id, u])),
  };
}
