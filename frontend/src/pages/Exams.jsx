// Elenco generale degli esami e pagina di aggiornamento del singolo esame.
import { useMemo, useState } from "react";
import { api } from "../api";
import { useApp } from "../appContext";
import { ConfirmButton, Count, PatientCell, StatusBadge } from "../components/common";
import { ExamTable } from "../components/ExamTable";
import { TrendChart } from "../components/TrendChart";
import { examDateProblem, examTrends, examView, filterExams, resolveStatus } from "../domain";
import { itDate } from "../format";
import { useAction } from "../hooks";
import { Link, useRouter } from "../router";
import { updateExam } from "../vault";

export function ExamsPage() {
  const { meta, vault } = useApp();
  const { query, pathname, search, navigate } = useRouter();
  const filters = {
    status: query.get("status") || "aperti",
    overdue: query.get("overdue") === "1",
    pathology: query.get("pathology") || "",
    exam_type: query.get("exam_type") || "",
  };
  const exams = useMemo(() => filterExams(vault, meta, filters),
    [vault, meta, filters.status, filters.overdue, filters.pathology, filters.exam_type]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (changes) => {
    const next = { ...filters, ...changes };
    const params = new URLSearchParams();
    if (next.status !== "aperti") params.set("status", next.status);
    if (next.overdue) params.set("overdue", "1");
    if (next.pathology) params.set("pathology", next.pathology);
    if (next.exam_type) params.set("exam_type", next.exam_type);
    navigate(`/esami${params.toString() ? "?" + params : ""}`, { replace: true });
  };

  return (
    <>
      <div className="page-head">
        <h1>Esami <Count n={exams.length} /></h1>
      </div>
      <form className="filters card" onSubmit={(e) => e.preventDefault()}>
        <label>Stato
          <select value={filters.status} onChange={(e) => apply({ status: e.target.value })}>
            <option value="aperti">Aperti (da effettuare + in attesa)</option>
            {Object.entries(meta.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value="tutti">Tutti</option>
          </select>
        </label>
        <label>Patologia
          <select value={filters.pathology} onChange={(e) => apply({ pathology: e.target.value })}>
            <option value="">Tutte</option>
            {meta.pathologies.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>Esame
          <select value={filters.exam_type} onChange={(e) => apply({ exam_type: e.target.value })}>
            <option value="">Tutti</option>
            {meta.exam_types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={filters.overdue} onChange={(e) => apply({ overdue: e.target.checked })} /> Solo in ritardo
        </label>
      </form>
      <section className="card flush">
        <ExamTable exams={exams} back={pathname + search} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
const fromExam = (e) => ({
  prescribed_date: e.prescribed_date || "",
  expected_date: e.expected_date || "",
  delivered_date: e.delivered_date || "",
  status: e.status,
  result_value: e.result_value || "",
  result_unit: e.result_unit || "",
  result_date: e.result_date || "",
  notes: e.notes || "",
});

export function ExamEditPage({ params }) {
  const { user, meta, vault, keys, reloadVault, flash } = useApp();
  const { query, navigate } = useRouter();
  const raw = vault.exams.find((x) => x.id === Number(params.id));
  const e = raw ? examView(raw, vault, meta) : null;
  const [f, setF] = useState(() => (e ? fromExam(e) : null));
  const [busy, run] = useAction();
  const trend = useMemo(() => (raw ? examTrends(vault, meta, raw.patient_id, raw.exam_type_id)[0] : null), [vault, meta, raw]);
  const history = useMemo(() => (raw ? vault.exams
    .filter((x) => x.patient_id === raw.patient_id && x.exam_type_id === raw.exam_type_id && x.status === "risultato" && x.id !== raw.id)
    .sort((a, b) => (b.result_date || "").localeCompare(a.result_date || "")).slice(0, 10)
    .map((x) => examView(x, vault, meta)) : []), [vault, meta, raw]);

  if (!e) return <div className="card narrow"><h1>Esame non trovato</h1><Link to="/esami">← Esami</Link></div>;

  const backTo = () => {
    const back = query.get("back");
    return back && back.startsWith("/") && !back.startsWith("//") ? back : `/pazienti/${e.patient_code}#esami`;
  };
  const set = (field) => (ev) => setF({ ...f, [field]: ev.target.value });
  const ro = !user.can_edit;

  const save = (ev) => {
    ev.preventDefault();
    const value = f.result_value.trim();
    const r = resolveStatus(f.status, f.delivered_date || null, value, f.result_date || null);
    const data = {
      exam_type_id: raw.exam_type_id, prescribed_date: f.prescribed_date, expected_date: f.expected_date || null,
      delivered_date: r.delivered, result_date: r.resultDate, status: r.status, result_value: value || null,
      result_unit: f.result_unit.trim() || null, notes: f.notes,
    };
    const problem = examDateProblem(data);
    if (problem) return flash(problem, "error");
    run(async () => {
      try {
        await updateExam(keys, e.id, data);
        await reloadVault();
        flash("Esame aggiornato.");
        navigate(backTo());
      } catch (err) {
        flash(err.message, "error");
      }
    });
  };
  const remove = async () => {
    try {
      await api.del(`/api/exams/${e.id}`);
      await reloadVault();
      flash("Esame eliminato.");
      navigate(`/pazienti/${e.patient_code}#esami`);
    } catch (err) {
      flash(err.message, "error");
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="back" to={`/pazienti/${e.patient_code}#esami`}>← Scheda {e.patient_code}</Link>
          <h1>{e.type_name}</h1>
          <div className="tags"><PatientCell code={e.patient_code} name={e.patient_name} /> <StatusBadge exam={e} /></div>
        </div>
      </div>

      <form className="stack" onSubmit={save}>
        <fieldset className="card" disabled={ro}>
          <legend>Date e stato</legend>
          <div className="form-grid">
            <label>Data prescrizione *<input type="date" value={f.prescribed_date} onChange={set("prescribed_date")} required /></label>
            <label>Data prevista di consegna<input type="date" value={f.expected_date} onChange={set("expected_date")} /></label>
            <label>Data effettiva di consegna<input type="date" value={f.delivered_date} onChange={set("delivered_date")} /></label>
            <label>Stato
              <select value={f.status} onChange={set("status")}>
                {Object.entries(meta.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <p className="hint">Lo stato avanza da solo: inserendo la data di consegna diventa “Consegnato”, inserendo un risultato diventa “Risultato disponibile”.</p>
        </fieldset>

        <fieldset className="card" disabled={ro}>
          <legend>Risultato</legend>
          <div className="form-grid">
            <label>Valore / esito<input value={f.result_value} onChange={set("result_value")} placeholder="es. 14,2 · soppresso · nella norma" /></label>
            <label>Unità di misura<input value={f.result_unit} onChange={set("result_unit")} /></label>
            <label>Data risultato<input type="date" value={f.result_date} onChange={set("result_date")} /></label>
            <label className="span-3">Note / commento
              <textarea rows={4} value={f.notes} onChange={set("notes")} />
            </label>
          </div>
          <p className="hint">Prescritto da {e.prescriber || "n.d."} il {itDate(e.prescribed_date)}. 🔒 Tutti i dati dell'esame sono cifrati nel browser.</p>
        </fieldset>

        {!ro && <div className="actions"><button className="btn primary" disabled={busy}>Salva</button></div>}
      </form>

      {!ro && (
        <div className="danger-zone">
          <ConfirmButton className="btn danger small" message="Eliminare definitivamente questo esame?" onConfirm={remove}>
            Elimina esame
          </ConfirmButton>
        </div>
      )}

      {trend && (
        <section className="card">
          <h2>Andamento nel tempo <span className="muted">{trend.unit}</span></h2>
          <TrendChart points={trend.points} unit={trend.unit} />
        </section>
      )}

      {history.length > 0 && (
        <section className="card">
          <h2>Risultati precedenti dello stesso esame</h2>
          <table className="table compact">
            <thead><tr><th>Data risultato</th><th>Valore</th><th>Note</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{itDate(h.result_date)}</td>
                  <td><strong>{h.result_value}</strong> {h.result_unit || ""}</td>
                  <td>{h.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
