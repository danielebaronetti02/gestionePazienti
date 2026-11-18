import { useMemo } from "react";
import { useApp } from "../appContext";
import { PatientCell } from "../components/common";
import { ExamTable } from "../components/ExamTable";
import { dashboard } from "../domain";
import { itDate } from "../format";
import { Link } from "../router";

function Kpi({ to, label, value, note, alert }) {
  return (
    <Link className={`kpi${alert ? " kpi-alert" : ""}`} to={to}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-note">{note}</span>
    </Link>
  );
}

export function DashboardPage() {
  const { user, vault, meta } = useApp();
  const d = useMemo(() => dashboard(vault, meta), [vault, meta]);
  const max = Math.max(1, ...d.by_pathology.map((r) => r.count));

  return (
    <>
      <div className="page-head">
        <h1>Dashboard</h1>
        {user.can_edit && user.can_view_identity && (
          <Link className="btn primary" to="/pazienti/nuovo">
            + Nuovo paziente
          </Link>
        )}
      </div>
            <>
              <section className="kpis">
                <Kpi to="/pazienti" label="Pazienti in carico" value={d.total_patients} note={`${d.archived_patients} archiviati`} />
                <Kpi to="/esami?status=da_effettuare" label="Esami da effettuare" value={d.exam_counts.da_effettuare}
                     note="prescritti, non ancora consegnati" />
                <Kpi to="/esami?status=da_effettuare&overdue=1" label="In ritardo" value={d.overdue}
                     note="data prevista superata" alert />
                <Kpi to="/esami?status=consegnato" label="In attesa di risultato" value={d.exam_counts.consegnato} note="consegnati" />
                <Kpi to="/esami?status=risultato" label="Risultati ultimi 30 gg" value={d.recent_results}
                     note={`${d.exam_counts.risultato} in totale`} />
              </section>

              <div className="grid-2">
                <section className="card">
                  <h2>Pazienti per patologia</h2>
                  {d.by_pathology.length ? (
                    <ul className="bars">
                      {d.by_pathology.map((r) => (
                        <li key={r.id ?? "none"}>
                          <Link className="bar-label" to={`/pazienti?pathology=${r.id ?? "none"}`}>
                            {r.name}
                          </Link>
                          <span className="bar-track">
                            <span className="bar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
                          </span>
                          <span className="bar-n">{r.count}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty">Nessun paziente registrato.</p>
                  )}
                </section>

                <section className="card">
                  <h2>Schede aggiornate di recente</h2>
                  {d.recent_patients.length ? (
                    <table className="table compact">
                      <tbody>
                        {d.recent_patients.map((p) => (
                          <tr key={p.code}>
                            <td>
                              <PatientCell code={p.code} name={p.name} />
                            </td>
                            <td>{p.pathology || "—"}</td>
                            <td className="right muted">{itDate(p.updated_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="empty">Nessun paziente.</p>
                  )}
                </section>
              </div>

              <section className="card">
                <div className="card-head">
                  <h2>Esami da effettuare</h2>
                  <Link to="/esami?status=da_effettuare">Vedi tutti →</Link>
                </div>
                <ExamTable exams={d.to_do} back="/" />
              </section>

              <section className="card">
                <div className="card-head">
                  <h2>Esami consegnati in attesa di risultato</h2>
                  <Link to="/esami?status=consegnato">Vedi tutti →</Link>
                </div>
                <ExamTable exams={d.waiting} back="/" />
              </section>
            </>
    </>
  );
}
