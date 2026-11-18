// Esportazione Excel costruita nel browser dai dati decifrati (il server non può farla).
import { age } from "../format";
import { examView, parseNumeric } from "../domain";
import { buildXlsx, XLSX_MIME } from "./xlsx";

const d = (iso) => (iso ? new Date(iso + "T00:00:00") : null);
const itDate = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

/**
 * opt = { pathology_id, date_from, date_to, identity, notes, archived }
 * Restituisce { blob, filename, patients, exams }.
 */
export function buildExport(vault, meta, user, opt) {
  const withIdentity = Boolean(opt.identity && user.can_view_identity);
  const inPeriod = (iso) => (!opt.date_from || (iso && iso >= opt.date_from)) && (!opt.date_to || (iso && iso <= opt.date_to));

  const patients = vault.patients
    .filter((p) => !p.error && (opt.archived || !p.clinical.archived))
    .filter((p) => !opt.pathology_id || String(p.clinical.pathology_id) === String(opt.pathology_id))
    .sort((a, b) => (meta.pathologiesById.get(a.clinical.pathology_id)?.name || "").localeCompare(
      meta.pathologiesById.get(b.clinical.pathology_id)?.name || "") || a.code.localeCompare(b.code));
  const ids = new Set(patients.map((p) => p.id));
  const exams = vault.exams
    .filter((e) => ids.has(e.patient_id) && !e.error && inPeriod(e.prescribed_date))
    .map((e) => examView(e, vault, meta))
    .sort((a, b) => a.patient_code.localeCompare(b.patient_code) || a.category.localeCompare(b.category) ||
      a.type_name.localeCompare(b.type_name) || (a.prescribed_date || "").localeCompare(b.prescribed_date || ""));
  const visits = vault.visits
    .filter((v) => ids.has(v.patient_id) && !v.error && inPeriod(v.visit_date))
    .sort((a, b) => (a.visit_date || "").localeCompare(b.visit_date || ""));
  const pathologyName = (p) => meta.pathologiesById.get(p.clinical.pathology_id)?.name || null;

  // --- Pazienti ---
  const pCols = ["Codice", ...(withIdentity ? ["Cognome", "Nome", "Data di nascita", "Luogo di nascita", "Codice fiscale",
    "Telefono", "Email"] : []), "Età (anni)", "Sesso", "Patologia", "Data diagnosi", "N. visite", "Ultima visita", "Archiviato",
    ...(opt.notes ? ["Note cliniche"] : [])];
  const pRows = patients.map((p) => {
    const pv = vault.visits.filter((v) => v.patient_id === p.id && v.visit_date).map((v) => v.visit_date).sort();
    const i = p.identity || {};
    return [p.code,
      ...(withIdentity ? [i.last_name, i.first_name, d(i.birth_date), i.birth_place, i.tax_code, i.phone, i.email] : []),
      p.identity?.birth_date ? age(p.identity.birth_date) : null, p.clinical.sex, pathologyName(p), d(p.clinical.diagnosis_date),
      pv.length, d(pv[pv.length - 1]), p.clinical.archived ? "Sì" : "No", ...(opt.notes ? [p.clinical.notes] : [])];
  });

  // --- Esami (formato lungo, adatto alle analisi statistiche) ---
  const eCols = ["Codice", "Patologia", "Esame", "Categoria", "Data prescrizione", "Data prevista", "Data consegna",
    "Data risultato", "Stato", "In ritardo", "Risultato (testo)", "Risultato (numero)", "Unità", ...(opt.notes ? ["Note"] : [])];
  const eRows = exams.map((e) => [e.patient_code, e.pathology, e.type_name, e.category, d(e.prescribed_date), d(e.expected_date),
    d(e.delivered_date), d(e.result_date), meta.statuses[e.status], e.overdue ? "Sì" : "", e.result_value,
    parseNumeric(e.result_value), e.result_unit, ...(opt.notes ? [e.notes] : [])]);

  // --- Ultimi risultati: una riga per paziente, una colonna per esame ---
  const columns = new Map();
  const latest = new Map();
  [...exams].sort((a, b) => (a.result_date || "").localeCompare(b.result_date || "")).forEach((e) => {
    const v = e.status === "risultato" ? parseNumeric(e.result_value) : null;
    if (v === null) return;
    const label = e.type_name + (e.result_unit ? ` (${e.result_unit})` : "");
    columns.set(label, true);
    const row = latest.get(e.patient_code) || { pathology: e.pathology, values: {} };
    row.values[label] = v;
    latest.set(e.patient_code, row);
  });
  const lCols = ["Codice", "Patologia", ...columns.keys()];
  const lRows = [...latest.entries()].map(([code, r]) => [code, r.pathology, ...[...columns.keys()].map((c) => r.values[c] ?? null)]);

  // --- Visite ---
  const codeOf = (id) => vault.patientsById.get(id)?.code;
  const vCols = ["Codice", "Patologia", "Data visita", "Tipo", "Medico", ...(opt.notes ? ["Note"] : [])];
  const vRows = visits.map((v) => [codeOf(v.patient_id), pathologyName(vault.patientsById.get(v.patient_id)), d(v.visit_date),
    v.visit_type, meta.usersById.get(v.created_by)?.full_name, ...(opt.notes ? [v.notes] : [])]);

  // --- Riepilogo ---
  const counts = new Map();
  patients.forEach((p) => counts.set(pathologyName(p) || "Non assegnata", (counts.get(pathologyName(p) || "Non assegnata") || 0) + 1));
  const now = new Date();
  const summary = [
    [{ bold: true, text: "Esportazione Gestione Pazienti" }], [],
    [{ bold: true, text: "Data esportazione" }, `${now.toLocaleDateString("it-IT")} ${now.toLocaleTimeString("it-IT").slice(0, 5)}`],
    [{ bold: true, text: "Esportato da" }, user.full_name],
    [{ bold: true, text: "Dati anagrafici inclusi" }, withIdentity ? "Sì" : "No (solo codice pseudonimo)"],
    [{ bold: true, text: "Note incluse" }, opt.notes ? "Sì" : "No"],
    [{ bold: true, text: "Pazienti archiviati inclusi" }, opt.archived ? "Sì" : "No"],
    [{ bold: true, text: "Periodo esami/visite" }, `${opt.date_from ? itDate(opt.date_from) : "inizio"} – ${opt.date_to ? itDate(opt.date_to) : "oggi"}`],
    [{ bold: true, text: "Pazienti" }, patients.length], [{ bold: true, text: "Esami" }, exams.length], [{ bold: true, text: "Visite" }, visits.length],
    [], [{ bold: true, text: "Pazienti per patologia" }],
    ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => [n, c]),
    [], [{ bold: true, text: "Esami per stato" }],
    ...Object.entries(meta.statuses).map(([k, label]) => [label, exams.filter((e) => e.status === k).length]),
    ...(withIdentity ? [[], [{ bold: true, text: "ATTENZIONE: il file contiene dati personali identificativi. Conservarlo in modo sicuro." }]] : []),
  ];

  const bytes = buildXlsx([
    { name: "Riepilogo", plain: true, rows: summary, widths: [34, 40] },
    { name: "Pazienti", columns: pCols, rows: pRows },
    { name: "Esami", columns: eCols, rows: eRows },
    { name: "Ultimi risultati", columns: lCols, rows: lRows },
    { name: "Visite", columns: vCols, rows: vRows },
  ]);
  const filename = `pazienti_${now.toISOString().slice(0, 10)}_${withIdentity ? "IDENTIFICATIVO" : "pseudonimizzato"}.xlsx`;
  return { blob: new Blob([bytes], { type: XLSX_MIME }), filename, patients: patients.length, exams: exams.length, withIdentity };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

