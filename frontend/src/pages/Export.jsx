import { useApp } from "../appContext";
import { buildExport, downloadBlob } from "../excel/exportWorkbook";
import { useAction, useForm } from "../hooks";
import { logEvent } from "../vault";

export function ExportPage() {
  const { user, meta, vault, flash } = useApp();
  const [f, bind] = useForm({ pathology_id: "", date_from: "", date_to: "", archived: false, notes: false, identity: false });
  const [busy, run] = useAction();

  const submit = (e) => {
    e.preventDefault();
    if (f.date_from && f.date_to && f.date_to < f.date_from) return flash("La data finale precede quella iniziale.", "error");
    run(async () => {
      try {
        const res = buildExport(vault, meta, user, f);
        downloadBlob(res.blob, res.filename);
        await logEvent(res.withIdentity ? "esportazione_excel_con_anagrafica" : "esportazione_excel", null,
          `${res.patients} pazienti, ${res.exams} esami; patologia=${f.pathology_id || "tutte"}, dal=${f.date_from || "-"}, al=${f.date_to || "-"}, note=${f.notes ? "sì" : "no"}`);
        flash(`File scaricato: ${res.filename}`);
      } catch (err) {
        flash(err.message, "error");
      }
    });
  };

  return (
    <>
      <div className="page-head"><h1>Esporta in Excel</h1></div>
      <form className="card narrow-wide" onSubmit={submit}>
        <div className="form-grid">
          <label>Patologia
            <select value={f.pathology_id} onChange={bind("pathology_id")}>
              <option value="">Tutte</option>
              {meta.pathologies.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Esami e visite dal<input type="date" value={f.date_from} onChange={bind("date_from")} /></label>
          <label>al<input type="date" value={f.date_to} onChange={bind("date_to")} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.archived} onChange={bind("archived")} /> Includi pazienti archiviati</label>
        <label className="check"><input type="checkbox" checked={f.notes} onChange={bind("notes")} /> Includi note cliniche e note di esami/visite</label>
        {user.can_view_identity && (
          <>
            <label className="check"><input type="checkbox" checked={f.identity} onChange={bind("identity")} /> Includi dati anagrafici (nome, CF, contatti)</label>
            <p className="hint warn">
              Senza anagrafica il file è <strong>pseudonimizzato</strong>: contiene solo codici paziente, età, sesso, patologia ed esami,
              ed è la scelta adatta alla ricerca. Le note libere possono contenere dati identificativi: includile solo se servono.
            </p>
          </>
        )}
        <div className="actions"><button className="btn primary" disabled={busy}>{busy ? "Preparazione…" : "Scarica file .xlsx"}</button></div>
        <p className="hint">
          Il file viene creato in questo browser dai dati decifrati: il server non vede il contenuto. L'esportazione viene registrata nel registro accessi.
        </p>
      </form>

      <div className="card legend-box narrow-wide">
        <h3>Contenuto del file</h3>
        <ul>
          <li><strong>Riepilogo</strong>: filtri usati, pazienti per patologia, esami per stato.</li>
          <li><strong>Pazienti</strong>: una riga per paziente.</li>
          <li><strong>Esami</strong>: una riga per esame, con date, stato e risultato anche in forma numerica (pronto per analisi statistiche).</li>
          <li><strong>Ultimi risultati</strong>: una riga per paziente, una colonna per esame con l'ultimo valore numerico.</li>
          <li><strong>Visite</strong>: storico delle visite.</li>
        </ul>
      </div>
    </>
  );
}
