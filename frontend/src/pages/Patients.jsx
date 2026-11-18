import { useEffect, useMemo, useState } from "react";
import { useApp } from "../appContext";
import { Count, PatientCell } from "../components/common";
import { listPatients } from "../domain";
import { itDate } from "../format";
import { Link, useRouter } from "../router";

export function PatientsPage() {
  const { user, meta, vault } = useApp();
  const { query, navigate } = useRouter();
  const filters = {
    q: query.get("q") || "",
    pathology: query.get("pathology") || "",
    archived: query.get("archived") === "1",
  };
  const [q, setQ] = useState(filters.q);
  useEffect(() => setQ(filters.q), [filters.q]);
  // ricerca e filtri avvengono qui, sui dati decifrati in memoria
  const patients = useMemo(() => listPatients(vault, meta, filters), [vault, meta, filters.q, filters.pathology, filters.archived]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (changes) => {
    const next = { ...filters, ...changes };
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.pathology) params.set("pathology", next.pathology);
    if (next.archived) params.set("archived", "1");
    navigate(`/pazienti${params.toString() ? "?" + params : ""}`, { replace: true });
  };
  const anyFilter = filters.q || filters.pathology || filters.archived;

  return (
    <>
      <div className="page-head">
        <h1>Pazienti <Count n={patients.length} /></h1>
        {user.can_edit && user.can_view_identity && <Link className="btn primary" to="/pazienti/nuovo">+ Nuovo paziente</Link>}
      </div>

      <form className="filters card" onSubmit={(e) => { e.preventDefault(); apply({ q }); }}>
        <label className="grow">
          Cerca
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder={user.can_view_identity ? "Codice, cognome, nome o codice fiscale" : "Codice paziente (es. PZ-AB12CD)"} />
        </label>
        <label>
          Patologia
          <select value={filters.pathology} onChange={(e) => apply({ pathology: e.target.value })}>
            <option value="">Tutte</option>
            {meta.pathologies.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="none">Non assegnata</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={filters.archived} onChange={(e) => apply({ archived: e.target.checked })} /> Includi archiviati
        </label>
        <button className="btn">Filtra</button>
        {anyFilter && (
          <button type="button" className="btn ghost" onClick={() => { setQ(""); navigate("/pazienti", { replace: true }); }}>Azzera</button>
        )}
      </form>

      {patients.length ? (
        <div className="table-wrap card flush">
          <table className="table">
            <thead>
              <tr><th>Paziente</th><th>Sesso</th><th>Patologia</th><th>Diagnosi</th><th>Ultima visita</th><th>Esami aperti</th><th /></tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className={p.clinical.archived ? "row-archived" : undefined}>
                  <td>
                    <PatientCell code={p.code} name={p.name} />
                    {p.clinical.archived && <> <span className="badge b-muted">Archiviato</span></>}
                    {p.error && <> <span className="badge b-overdue">Non decifrabile</span></>}
                  </td>
                  <td>{p.clinical.sex || "—"}</td>
                  <td>{p.pathology || "—"}</td>
                  <td>{itDate(p.clinical.diagnosis_date)}</td>
                  <td>{itDate(p.last_visit)}</td>
                  <td>{p.open_exams ? <span className="badge b-todo">{p.open_exams}</span> : "—"}</td>
                  <td className="right"><Link className="btn small" to={`/pazienti/${p.code}`}>Apri scheda</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty card">Nessun paziente trovato.</p>
      )}
    </>
  );
}
