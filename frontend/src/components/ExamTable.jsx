import { useApp } from "../appContext";
import { itDate } from "../format";
import { Link } from "../router";
import { PatientCell, StatusBadge } from "./common";

export function ExamTable({ exams, showPatient = true, back }) {
  const { user } = useApp();
  if (!exams.length) return <p className="empty">Nessun esame.</p>;
  const editLink = (id) => `/esami/${id}${back ? `?back=${encodeURIComponent(back)}` : ""}`;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {showPatient && (
              <>
                <th>Paziente</th>
                <th>Patologia</th>
              </>
            )}
            <th>Esame</th>
            <th>Prescritto</th>
            <th>Previsto</th>
            <th>Consegnato</th>
            <th>Stato</th>
            <th>Risultato</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {exams.map((e) => (
            <tr key={e.id} className={e.overdue ? "row-overdue" : undefined}>
              {showPatient && (
                <>
                  <td>
                    <PatientCell code={e.patient_code} name={e.patient_name} />
                  </td>
                  <td>{e.pathology || "—"}</td>
                </>
              )}
              <td>
                <strong>{e.type_name}</strong>
                <div className="sub">{e.category}</div>
              </td>
              <td>{itDate(e.prescribed_date)}</td>
              <td>{itDate(e.expected_date)}</td>
              <td>{itDate(e.delivered_date)}</td>
              <td>
                <StatusBadge exam={e} />
              </td>
              <td>
                {e.result_value ? (
                  <>
                    <strong>{e.result_value}</strong> {e.result_unit || ""}
                    <div className="sub">{itDate(e.result_date)}</div>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="right">
                <Link className="btn small" to={editLink(e.id)}>
                  {user.can_edit ? "Aggiorna" : "Apri"}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
