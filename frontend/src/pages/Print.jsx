// Stampa della cartella clinica (o salvataggio in PDF con "Salva come PDF" del browser).
// Il documento è composto e stampato nel browser: i dati decifrati non passano dal server.
import { Fragment, useMemo, useState } from "react";
import { useApp } from "../appContext";
import { TrendBox } from "../components/TrendChart";
import { examTrends, patientExams, patientVisits } from "../domain";
import { age, itDate, itDateTime } from "../format";
import { Link } from "../router";
import { logEvent } from "../vault";

const SECTIONS = [
  ["anagrafica", "Anagrafica"],
  ["clinica", "Dati clinici e note"],
  ["esami", "Esami"],
  ["grafici", "Grafici dell'andamento"],
  ["visite", "Storico visite"],
];

function Row({ label, children }) {
  return <><dt>{label}</dt><dd>{children || "—"}</dd></>;
}

export function PrintPage({ params }) {
  const { user, meta, vault } = useApp();
  const p = vault.patientsByCode.get(params.code);
  const [show, setShow] = useState(() => Object.fromEntries(SECTIONS.map(([k]) => [k, true])));
  const [onlyResults, setOnlyResults] = useState(false);
  const [examNotes, setExamNotes] = useState(true);
  const exams = useMemo(() => (p ? patientExams(vault, meta, p.id) : []), [vault, meta, p]);
  const visits = useMemo(() => (p ? patientVisits(vault, p.id) : []), [vault, p]);
  const trends = useMemo(() => (p ? examTrends(vault, meta, p.id) : []), [vault, meta, p]);
  const printedAt = useMemo(() => {
    const d = new Date();
    const z = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
  }, []);

  if (!p) return <div className="card narrow"><h1>Paziente non trovato</h1><Link to="/pazienti">← Pazienti</Link></div>;

  const withIdentity = Boolean(p.identity) && show.anagrafica;
  const i = p.identity;
  const pathology = meta.pathologiesById.get(p.clinical.pathology_id)?.name;
  const examRows = exams
    .filter((e) => !e.error && (!onlyResults || e.status === "risultato"))
    .sort((a, b) => (a.category || "").localeCompare(b.category || "") || (a.type_name || "").localeCompare(b.type_name || "")
      || (a.result_date || a.prescribed_date || "").localeCompare(b.result_date || b.prescribed_date || ""));
  const byCategory = [];
  for (const e of examRows) {
    const last = byCategory[byCategory.length - 1];
    if (last && last.category === (e.category || "Altro")) last.items.push(e);
    else byCategory.push({ category: e.category || "Altro", items: [e] });
  }

  const print = () => {
    const parts = SECTIONS.filter(([k]) => show[k] && (k !== "anagrafica" || p.identity)).map(([, l]) => l.toLowerCase());
    logEvent("stampa_scheda", p.code, `${withIdentity ? "con anagrafica" : "senza anagrafica"}: ${parts.join(", ")}`);
    window.print();
  };
  const toggle = (k) => setShow({ ...show, [k]: !show[k] });

  return (
    <>
      <div className="no-print">
        <div className="page-head">
          <div>
            <Link className="back" to={`/pazienti/${p.code}`}>← Scheda {p.code}</Link>
            <h1>Stampa cartella clinica</h1>
          </div>
          <button type="button" className="btn primary" onClick={print}>🖨 Stampa / Salva PDF</button>
        </div>
        <section className="card print-options">
          <div className="checks">
            {SECTIONS.map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={show[k]} onChange={() => toggle(k)}
                       disabled={k === "anagrafica" && !p.identity} />
                {" "}{label}{k === "anagrafica" && !p.identity && " (non autorizzato: solo codice)"}
              </label>
            ))}
            <label className="check">
              <input type="checkbox" checked={onlyResults} onChange={(e) => setOnlyResults(e.target.checked)} /> Solo esami con risultato
            </label>
            <label className="check">
              <input type="checkbox" checked={examNotes} onChange={(e) => setExamNotes(e.target.checked)} /> Note degli esami
            </label>
          </div>
          <p className="hint">
            Per ottenere un PDF scegli <strong>“Salva come PDF”</strong> come stampante nella finestra di stampa.
            Il documento contiene dati sanitari: conservalo e condividilo solo secondo le regole dell'unità.
            {!withIdentity && " Senza anagrafica il paziente compare solo con il codice."}
          </p>
        </section>
        <h2 className="preview-title">Anteprima</h2>
      </div>

      <article className="print-doc">
        <header className="print-header">
          <div>
            <div className="print-brand">Gestione Pazienti · Cartella clinica</div>
            <h1>
              {withIdentity ? <>{i.last_name} {i.first_name}</> : <>Paziente {p.code}</>}
              {withIdentity && <span className="mono print-code">{p.code}</span>}
            </h1>
            {pathology && <div className="print-sub">{pathology}{p.clinical.archived ? " · paziente archiviato" : ""}</div>}
          </div>
          <div className="print-meta">
            Stampata il {itDateTime(printedAt)}<br />da {user.full_name}
          </div>
        </header>

        {show.anagrafica && withIdentity && (
          <section className="print-section">
            <h2>Anagrafica</h2>
            <dl className="print-dl">
              <Row label="Cognome e nome">{i.last_name} {i.first_name}</Row>
              <Row label="Data di nascita">{i.birth_date ? `${itDate(i.birth_date)} (${age(i.birth_date)} anni)` : null}</Row>
              <Row label="Luogo di nascita">{i.birth_place}</Row>
              <Row label="Codice fiscale"><span className="mono">{i.tax_code}</span></Row>
              <Row label="Telefono">{i.phone}</Row>
              <Row label="Email">{i.email}</Row>
              <Row label="Indirizzo">{i.address}</Row>
            </dl>
          </section>
        )}

        {show.clinica && (
          <section className="print-section">
            <h2>Dati clinici</h2>
            <dl className="print-dl">
              <Row label="Codice paziente"><span className="mono">{p.code}</span></Row>
              <Row label="Sesso">{meta.sexes[p.clinical.sex]}</Row>
              <Row label="Patologia">{pathology}</Row>
              <Row label="Data diagnosi">{p.clinical.diagnosis_date ? itDate(p.clinical.diagnosis_date) : null}</Row>
              <Row label="Scheda creata">{itDate(p.created_at)}</Row>
              <Row label="Ultimo aggiornamento">{itDate(p.updated_at)}</Row>
            </dl>
            <h3>Note cliniche</h3>
            {p.clinical.notes ? <div className="print-notes">{p.clinical.notes}</div> : <p className="muted">Nessuna nota.</p>}
          </section>
        )}

        {show.esami && (
          <section className="print-section">
            <h2>Esami <span className="muted">({examRows.length})</span></h2>
            {examRows.length === 0 ? <p className="muted">Nessun esame.</p> : (
              <table className="print-table">
                <thead>
                  <tr><th>Esame</th><th>Prescritto</th><th>Stato</th><th>Risultato</th><th>Data</th><th>Riferimento</th></tr>
                </thead>
                {byCategory.map((g) => (
                  <tbody key={g.category}>
                    <tr className="print-cat"><td colSpan={6}>{g.category}</td></tr>
                    {g.items.map((e) => {
                      const long = (e.result_value || "").length > 40;
                      const hasNote = examNotes && e.notes;
                      return (
                        <Fragment key={e.id}>
                          <tr className={hasNote ? "with-note" : undefined}>
                            <td><strong>{e.type_name}</strong></td>
                            <td className="nowrap">{itDate(e.prescribed_date)}</td>
                            <td className="nowrap">{meta.statuses[e.status]}{e.overdue ? " (in ritardo)" : ""}</td>
                            <td className={long ? "print-long" : e.out_of_range ? "print-out" : undefined}>
                              {e.result_value ? <>{e.result_value} {e.result_unit}{e.out_of_range ? " ⚠" : ""}</> : "—"}
                            </td>
                            <td className="nowrap">{e.result_date ? itDate(e.result_date) : "—"}</td>
                            <td className="print-small">{e.reference_range || ""}</td>
                          </tr>
                          {hasNote && <tr className="print-note"><td colSpan={6}>Note: {e.notes}</td></tr>}
                        </Fragment>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            )}
            {examRows.some((e) => e.out_of_range) && <p className="print-small">⚠ = fuori dall'intervallo di riferimento</p>}
          </section>
        )}

        {show.grafici && trends.length > 0 && (
          <section className="print-section">
            <h2>Andamento degli esami</h2>
            <div className="print-trends">
              {trends.map((s) => <TrendBox key={s.exam_type_id} series={s} />)}
            </div>
          </section>
        )}

        {show.visite && (
          <section className="print-section">
            <h2>Storico visite <span className="muted">({visits.filter((v) => !v.error).length})</span></h2>
            {visits.length === 0 ? <p className="muted">Nessuna visita registrata.</p> : (
              <ol className="print-visits">
                {visits.filter((v) => !v.error).map((v) => (
                  <li key={v.id}>
                    <div><strong>{itDate(v.visit_date)}</strong> · {v.visit_type || "Visita"}
                      <span className="muted"> — {meta.usersById.get(v.created_by)?.full_name || "n.d."}</span></div>
                    {v.notes && <div className="print-notes">{v.notes}</div>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        <footer className="print-footer">
          Documento contenente dati sanitari riservati (Reg. UE 2016/679). Generato da Gestione Pazienti il {itDateTime(printedAt)}.
        </footer>
      </article>
    </>
  );
}
