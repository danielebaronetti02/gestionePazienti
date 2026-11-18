// Scheda paziente: anagrafica, dati clinici, esami, andamenti, storico visite.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../appContext";
import { ConfirmButton, Count } from "../components/common";
import { ExamTable } from "../components/ExamTable";
import { TrendBox } from "../components/TrendChart";
import { examTrends, patientExams, patientVisits } from "../domain";
import { age, itDate, todayIso } from "../format";
import { useAction } from "../hooks";
import { Link, useRouter } from "../router";
import { addExams, addVisit, deletePatient, logEvent, updatePatient } from "../vault";

function Identity({ p }) {
  if (!p.identity) {
    return (
      <p className="reserved">
        🔒 Dati identificativi riservati. Il paziente è identificato solo dal codice <strong>{p.code}</strong>.
      </p>
    );
  }
  const i = p.identity;
  return (
    <dl className="dl">
      <dt>Cognome e nome</dt><dd>{i.last_name} {i.first_name}</dd>
      <dt>Data di nascita</dt>
      <dd>{itDate(i.birth_date)}{i.birth_date && <span className="muted"> ({age(i.birth_date)} anni)</span>}</dd>
      <dt>Luogo di nascita</dt><dd>{i.birth_place || "—"}</dd>
      <dt>Codice fiscale</dt><dd className="mono">{i.tax_code || "—"}</dd>
      <dt>Telefono</dt><dd>{i.phone || "—"}</dd>
      <dt>Email</dt><dd>{i.email || "—"}</dd>
      <dt>Indirizzo</dt><dd>{i.address || "—"}</dd>
    </dl>
  );
}

function PrescribeForm({ patientId, open, onDone }) {
  // aperto all'inizio se non ci sono esami; poi lo decide l'utente (non va richiuso a ogni ricarica dei dati)
  const detailsRef = useRef(null);
  useEffect(() => { if (open && detailsRef.current) detailsRef.current.open = true; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const { meta, keys, flash } = useApp();
  const [selected, setSelected] = useState([]);
  const [f, setF] = useState({ prescribed_date: todayIso(), expected_date: "", notes: "" });
  const [busy, run] = useAction();
  const groups = {};
  meta.exam_types.filter((t) => t.active).forEach((t) => (groups[t.category] ||= []).push(t));
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        if (f.expected_date && f.expected_date < f.prescribed_date) throw new Error("La data prevista non può precedere la prescrizione.");
        const exams = selected.map((id) => ({
          exam_type_id: id, prescribed_date: f.prescribed_date, expected_date: f.expected_date || null,
          status: "da_effettuare", result_unit: meta.examTypesById.get(id)?.unit || "", notes: f.notes,
        }));
        await addExams(keys, patientId, exams);
        flash(`${exams.length} esame/i prescritto/i.`);
        setSelected([]);
        setF({ ...f, expected_date: "", notes: "" });
        await onDone();
      } catch (err) {
        flash(err.message, "error");
      }
    });
  };

  return (
    <details className="prescribe" ref={detailsRef}>
      <summary className="btn primary">+ Prescrivi esami</summary>
      <form onSubmit={submit}>
        <div className="exam-picker">
          {Object.entries(groups).map(([cat, types]) => (
            <div className="exam-group" key={cat}>
              <h4>{cat}</h4>
              {types.map((t) => (
                <label className="check" key={t.id}>
                  <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} /> {t.name}
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="form-grid">
          <label>Data prescrizione *
            <input type="date" value={f.prescribed_date} onChange={(e) => setF({ ...f, prescribed_date: e.target.value })} required />
          </label>
          <label>Data prevista di consegna
            <input type="date" value={f.expected_date} onChange={(e) => setF({ ...f, expected_date: e.target.value })} />
          </label>
          <label className="span-3">Note (es. "a digiuno", "prelievo ore 8", "sospendere terapia 24 h prima")
            <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </label>
        </div>
        <div className="actions">
          <button className="btn primary" disabled={busy || !selected.length}>Prescrivi selezionati</button>
        </div>
      </form>
    </details>
  );
}

function VisitForm({ patientId, onDone }) {
  const { meta, keys, flash } = useApp();
  const [f, setF] = useState({ visit_date: todayIso(), visit_type: meta.visit_types[0], notes: "" });
  const [busy, run] = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        await addVisit(keys, patientId, f);
        flash("Visita registrata.");
        setF({ ...f, notes: "" });
        await onDone();
      } catch (err) {
        flash(err.message, "error");
      }
    });
  };
  return (
    <details className="prescribe">
      <summary className="btn">+ Registra visita</summary>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>Data visita *
            <input type="date" value={f.visit_date} onChange={(e) => setF({ ...f, visit_date: e.target.value })} required />
          </label>
          <label>Tipo
            <select value={f.visit_type} onChange={(e) => setF({ ...f, visit_type: e.target.value })}>
              {meta.visit_types.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="span-3">Note della visita <span className="lock">🔒 cifrate</span>
            <textarea rows={4} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </label>
        </div>
        <div className="actions"><button className="btn primary" disabled={busy}>Salva visita</button></div>
      </form>
    </details>
  );
}

export function PatientDetailPage({ params }) {
  const { user, meta, vault, keys, reloadVault, flash } = useApp();
  const { hash, navigate } = useRouter();
  const p = vault.patientsByCode.get(params.code.toUpperCase());
  const exams = useMemo(() => (p ? patientExams(vault, meta, p.id) : []), [vault, meta, p]);
  const visits = useMemo(() => (p ? patientVisits(vault, p.id) : []), [vault, p]);
  const trends = useMemo(() => (p ? examTrends(vault, meta, p.id) : []), [vault, meta, p]);
  const pathology = p ? meta.pathologiesById.get(p.clinical.pathology_id)?.name : null;

  useEffect(() => {  // registro accessi: l'apertura avviene nel browser, quindi la segnala il browser
    if (p) logEvent(p.identity ? "apertura_scheda_con_anagrafica" : "apertura_scheda", p.code);
  }, [p?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {  // porta alla sezione indicata (es. #esami)
    if (p && hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [p, hash]);

  if (!p) return <div className="card narrow"><h1>Paziente non trovato</h1><Link to="/pazienti">← Pazienti</Link></div>;

  const toggleArchive = async () => {
    try {
      const archived = !p.clinical.archived;
      await updatePatient(keys, p.id, { ...p.clinical, archived }, null, archived ? "archivia_paziente" : "ripristina_paziente");
      await reloadVault();
      flash(archived ? "Paziente archiviato." : "Paziente ripristinato.");
    } catch (err) {
      flash(err.message, "error");
    }
  };
  const removePatient = async () => {
    const typed = window.prompt(
      `Eliminare DEFINITIVAMENTE il paziente ${p.code}${p.identity ? ` (${p.identity.last_name} ${p.identity.first_name})` : ""}`
      + ` con ${exams.length} esami e ${visits.length} visite?\n\nNon si può annullare (resta solo nei backup).`
      + `\nPer confermare scrivi il codice del paziente: ${p.code}`);
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== p.code) { flash("Codice non corrispondente: paziente NON eliminato.", "error"); return; }
    try {
      await deletePatient(p.id);
      await reloadVault();
      flash(`Paziente ${p.code} eliminato.`);
      navigate("/pazienti");
    } catch (err) {
      flash(err.message, "error");
    }
  };
  const deleteVisit = async (id) => {
    try {
      await api.del(`/api/visits/${id}`);
      await reloadVault();
      flash("Visita eliminata.");
    } catch (err) {
      flash(err.message, "error");
    }
  };

  return (
        <>
          <div className="page-head">
            <div>
              <Link className="back" to="/pazienti">← Pazienti</Link>
              <h1>
                <span className="code big">{p.code}</span>
                {p.identity && <span className="pname">{p.identity.last_name} {p.identity.first_name}</span>}
              </h1>
              <div className="tags">
                {pathology ? <span className="badge b-path">{pathology}</span>
                             : <span className="badge b-muted">Patologia non assegnata</span>}
                {p.clinical.archived && <span className="badge b-muted">Archiviato</span>}
                {p.error && <span className="badge b-overdue">Dati non decifrabili</span>}
              </div>
            </div>
            <div className="btn-row">
              <Link className="btn" to={`/pazienti/${p.code}/stampa`}>🖨 Stampa / PDF</Link>
              {user.can_edit && (
                <>
                  <Link className="btn" to={`/pazienti/${p.code}/modifica`}>Modifica scheda</Link>
                  <ConfirmButton className="btn ghost" onConfirm={toggleArchive}
                    message={p.clinical.archived ? "Ripristinare il paziente tra quelli in carico?"
                      : "Archiviare il paziente? Non comparirà più in dashboard e negli elenchi (i dati restano conservati)."}>
                    {p.clinical.archived ? "Ripristina" : "Archivia"}
                  </ConfirmButton>
                </>
              )}
            </div>
          </div>

          <div className="grid-2">
            <section className="card">
              <h2>Anagrafica</h2>
              <Identity p={p} />
            </section>
            <section className="card">
              <h2>Dati clinici</h2>
              <dl className="dl">
                <dt>Sesso</dt><dd>{meta.sexes[p.clinical.sex] || "—"}</dd>
                <dt>Patologia</dt><dd>{pathology || "—"}</dd>
                <dt>Data diagnosi</dt><dd>{itDate(p.clinical.diagnosis_date)}</dd>
                <dt>Scheda creata</dt><dd>{itDate(p.created_at)}</dd>
                <dt>Ultimo aggiornamento</dt><dd>{itDate(p.updated_at)}</dd>
              </dl>
              <h3>Note cliniche</h3>
              {p.clinical.notes ? <div className="notes">{p.clinical.notes}</div> : <p className="empty">Nessuna nota.</p>}
            </section>
          </div>

          <section className="card" id="esami">
            <div className="card-head">
              <h2>Esami</h2>
              {user.can_edit && <Link className="btn" to={`/pazienti/${p.code}/importa`}>📄 Importa da PDF o foto</Link>}
            </div>
            {user.can_edit && <PrescribeForm patientId={p.id} open={!exams.length} onDone={reloadVault} />}
            <ExamTable exams={exams} showPatient={false} back={`/pazienti/${p.code}#esami`} />
          </section>

          {trends.length > 0 && (
            <section className="card" id="andamento">
              <h2>Andamento degli esami</h2>
              <div className="trend-grid">
                {trends.map((s) => <TrendBox key={s.exam_type_id} series={s} />)}
              </div>
            </section>
          )}

          <section className="card" id="visite">
            <div className="card-head"><h2>Storico visite <Count n={visits.length} /></h2></div>
            {user.can_edit && <VisitForm patientId={p.id} onDone={reloadVault} />}
            {visits.length ? (
              <ol className="timeline">
                {visits.map((v) => (
                  <li key={v.id}>
                    <div className="tl-head">
                      <strong>{itDate(v.visit_date)}</strong> · {v.visit_type || "Visita"}
                      <span className="muted">— {meta.usersById.get(v.created_by)?.full_name || "n.d."}</span>
                      {(user.is_admin || (user.can_edit && v.created_by === user.id)) && (
                        <ConfirmButton className="linklike danger right" message="Eliminare questa visita?"
                                       onConfirm={() => deleteVisit(v.id)}>
                          elimina
                        </ConfirmButton>
                      )}
                    </div>
                    {v.notes && <div className="notes">{v.notes}</div>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="empty">Nessuna visita registrata.</p>
            )}
          </section>

          {user.is_admin && (
            <div className="danger-zone">
              <button type="button" className="btn danger small" onClick={removePatient}>Elimina paziente</button>
              <span className="muted"> Solo amministratori: elimina scheda, esami e visite. Per toglierlo solo dagli elenchi usa “Archivia”.</span>
            </div>
          )}
        </>
  );
}
