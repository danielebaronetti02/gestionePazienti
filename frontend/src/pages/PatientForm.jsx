// Creazione e modifica della scheda paziente (cifrata nel browser prima del salvataggio).
import { useState } from "react";
import { useApp } from "../appContext";
import { useAction } from "../hooks";
import { Link, useRouter } from "../router";
import { createPatient, updatePatient } from "../vault";

const EMPTY_IDENTITY = { last_name: "", first_name: "", birth_date: "", birth_place: "", tax_code: "", phone: "", email: "", address: "" };

export function PatientFormPage({ params }) {
  const code = params.code; // assente = nuovo paziente
  const { user, meta, vault, keys, reloadVault, flash } = useApp();
  const { navigate } = useRouter();
  const patient = code ? vault.patientsByCode.get(code.toUpperCase()) : null;
  const withIdentity = user.can_view_identity && !!keys.identity;
  const [form, setForm] = useState(() => ({
    identity: { ...EMPTY_IDENTITY, ...(patient?.identity || {}) },
    sex: patient?.clinical.sex || "",
    pathology_id: patient?.clinical.pathology_id ?? "",
    diagnosis_date: patient?.clinical.diagnosis_date || "",
    notes: patient?.clinical.notes || "",
  }));
  const [busy, run] = useAction();

  if (code && !patient) return <div className="card narrow"><h1>Paziente non trovato</h1><Link to="/pazienti">← Pazienti</Link></div>;

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const setId = (field) => (e) => setForm({ ...form, identity: { ...form.identity, [field]: e.target.value } });
  const pathologies = meta.pathologies.filter((p) => p.active || String(p.id) === String(form.pathology_id));

  const submit = (e) => {
    e.preventDefault();
    const identity = { ...form.identity, tax_code: form.identity.tax_code.toUpperCase().replace(/\s/g, "") };
    if (withIdentity && (!identity.last_name.trim() || !identity.first_name.trim())) return flash("Cognome e nome sono obbligatori.", "error");
    const clinical = {
      ...(patient?.clinical || { archived: false }),
      sex: form.sex || null,
      pathology_id: form.pathology_id === "" ? null : Number(form.pathology_id),
      diagnosis_date: form.diagnosis_date || null,
      notes: form.notes,
    };
    run(async () => {
      try {
        if (patient) {
          await updatePatient(keys, patient.id, clinical, withIdentity ? identity : null);
          await reloadVault();
          flash("Scheda aggiornata.");
          navigate(`/pazienti/${patient.code}`);
        } else {
          const res = await createPatient(keys, identity, clinical);
          await reloadVault();
          flash(`Paziente creato con codice ${res.code}.`);
          navigate(`/pazienti/${res.code}`);
        }
      } catch (err) {
        flash(err.message, "error");
      }
    });
  };

  return (
    <>
      <div className="page-head">
        <h1>{code ? <>Modifica scheda <span className="code big">{patient.code}</span></> : "Nuovo paziente"}</h1>
        <Link className="btn ghost" to={code ? `/pazienti/${patient.code}` : "/pazienti"}>Annulla</Link>
      </div>

      <form className="stack" onSubmit={submit}>
        {withIdentity ? (
          <fieldset className="card">
            <legend>Dati anagrafici <span className="lock">🔒 cifrati nel browser</span></legend>
            <div className="form-grid">
              <label>Cognome *<input value={form.identity.last_name} onChange={setId("last_name")} required /></label>
              <label>Nome *<input value={form.identity.first_name} onChange={setId("first_name")} required /></label>
              <label>Data di nascita<input type="date" value={form.identity.birth_date} onChange={setId("birth_date")} /></label>
              <label>Luogo di nascita<input value={form.identity.birth_place} onChange={setId("birth_place")} /></label>
              <label>Codice fiscale<input value={form.identity.tax_code} onChange={setId("tax_code")} maxLength={16} className="upper" /></label>
              <label>Telefono<input value={form.identity.phone} onChange={setId("phone")} /></label>
              <label>Email<input type="email" value={form.identity.email} onChange={setId("email")} /></label>
              <label className="span-2">Indirizzo<input value={form.identity.address} onChange={setId("address")} /></label>
            </div>
          </fieldset>
        ) : (
          <div className="flash flash-info">Il tuo profilo non è abilitato ai dati anagrafici: puoi modificare solo i dati clinici.</div>
        )}

        <fieldset className="card">
          <legend>Dati clinici <span className="lock">🔒 cifrati nel browser</span></legend>
          <div className="form-grid">
            <label>Sesso
              <select value={form.sex} onChange={set("sex")}>
                <option value="">—</option>
                {Object.entries(meta.sexes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Patologia associata
              <select value={form.pathology_id} onChange={set("pathology_id")}>
                <option value="">— Non assegnata —</option>
                {pathologies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>Data diagnosi<input type="date" value={form.diagnosis_date} onChange={set("diagnosis_date")} /></label>
            <label className="span-3">Note cliniche
              <textarea rows={7} value={form.notes} onChange={set("notes")}
                        placeholder="Anamnesi, terapia in corso (es. idrocortisone, fludrocortisone), dosaggi, eventi rilevanti…" />
            </label>
          </div>
        </fieldset>

        <div className="actions">
          <button className="btn primary" disabled={busy}>{busy ? "Cifratura e salvataggio…" : code ? "Salva modifiche" : "Crea paziente"}</button>
        </div>
      </form>
    </>
  );
}
