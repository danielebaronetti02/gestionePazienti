// Importazione di una prescrizione o di un referto (PDF o foto) nella scheda di un paziente.
// Il documento viene letto nel browser; l'utente controlla l'anteprima e conferma.
import { useMemo, useState } from "react";
import { api } from "../api";
import { useApp } from "../appContext";
import { itDate, todayIso } from "../format";
import { addDays, compareTaxCode, detectKind, matchPrescription, matchReport, parsePrescription, parseReport } from "../importDocs/parse";
import { readDocument } from "../importDocs/readers";
import { Link, useRouter } from "../router";
import { addExams, logEvent, updateExam } from "../vault";

const NEW_TYPE = "__nuovo__";
const SOURCE_LABEL = { pdf: "PDF", "pdf-scansione": "PDF scansionato", foto: "foto" };

const sentence = (s) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s)
  .replace(/\(([^)]+)\)/g, (m, x) => `(${x.toUpperCase()})`);
const shortName = (d) => sentence((d.split(":")[0] || d).trim());

function findOpenExam(exams, typeId, used) {
  return exams
    .filter((e) => e.exam_type_id === typeId && e.status !== "risultato" && !used.has(e.id))
    .sort((a, b) => (a.prescribed_date || "").localeCompare(b.prescribed_date || ""))[0] || null;
}

function TypeSelect({ value, onChange, types, canCreate }) {
  const groups = useMemo(() => {
    const g = new Map();
    for (const t of types) g.set(t.category, [...(g.get(t.category) || []), t]);
    return [...g.entries()];
  }, [types]);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={value ? undefined : "unmatched"}>
      <option value="">— non importare —</option>
      {canCreate && <option value={NEW_TYPE}>＋ Crea nuovo tipo di esame…</option>}
      {groups.map(([cat, list]) => (
        <optgroup key={cat} label={cat}>
          {list.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export function ImportPage({ params }) {
  const { cfg, user, meta, vault, keys, reloadVault, reloadMeta, flash } = useApp();
  const { navigate } = useRouter();
  const p = vault.patientsByCode.get(params.code);
  const [status, setStatus] = useState(null);            // { busy, text } oppure { error }
  const [doc, setDoc] = useState(null);
  const [rows, setRows] = useState([]);
  const [ownerOk, setOwnerOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const exams = useMemo(() => (p ? vault.exams.filter((e) => e.patient_id === p.id && !e.error) : []), [vault, p]);
  const activeTypes = useMemo(() => meta.exam_types.filter((t) => t.active), [meta]);

  // cosa succederà a ogni riga selezionata (completa un esame già prescritto, oppure nuovo)
  const plan = useMemo(() => {
    const used = new Set();
    const out = new Map();
    for (const r of rows) {
      if (!r.selected || !r.typeId) continue;
      if (doc?.kind === "referto" && r.typeId !== NEW_TYPE) {
        const open = findOpenExam(exams, Number(r.typeId), used);
        if (open) { used.add(open.id); out.set(r.key, open); continue; }
      }
      out.set(r.key, null);
    }
    return out;
  }, [rows, exams, doc]);

  if (!p) return <div className="card narrow"><h1>Paziente non trovato</h1><Link to="/pazienti">← Pazienti</Link></div>;

  const patientCf = (p.identity?.tax_code || "").toUpperCase().replace(/\s/g, "") || null;
  let owner = null;
  if (doc) {
    if (!p.identity) owner = "riservato";
    else if (!doc.taxCodes.length) owner = "assente";
    else if (!patientCf) owner = "senza-cf";
    else owner = compareTaxCode(doc.taxCodes, patientCf);
  }
  const selected = rows.filter((r) => r.selected && r.typeId);
  const missingNames = selected.some((r) => r.typeId === NEW_TYPE && !r.newName.trim());
  const canSave = selected.length > 0 && !missingNames && (owner === "ok" || ownerOk) && !saving;

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setDocField = (k) => (e) => setDoc({ ...doc, [k]: e.target.value });

  const onFiles = async (ev) => {
    const files = [...ev.target.files];
    ev.target.value = "";
    if (!files.length) return;
    setDoc(null);
    setRows([]);
    setOwnerOk(false);
    setStatus({ busy: true, text: "Lettura del documento…" });
    try {
      const { pages, source } = await readDocument(files, {
        ocrAvailable: cfg.ocr_available, onStatus: (text) => setStatus({ busy: true, text }),
      });
      const fileNames = files.map((f) => f.name).join(", ");
      if (detectKind(pages) === "prescrizione") {
        const pr = parsePrescription(pages);
        if (!pr.items.length) throw new Error("Nessuna prestazione trovata nella prescrizione.");
        const date = pr.date || todayIso();
        const notes = [pr.nre && `Ricetta NRE ${pr.nre}`, pr.doctor && `Medico: ${pr.doctor}`,
                       pr.question && `Quesito: ${pr.question}`, pr.priority && `Priorità: ${pr.priority.label}`]
          .filter(Boolean).join(" · ");
        setDoc({ kind: "prescrizione", source, fileNames, taxCodes: pr.taxCodes, date, notes,
                 expected: pr.priority ? addDays(date, pr.priority.days) : "", priority: pr.priority?.label || null });
        setRows(matchPrescription(pr, activeTypes).map((it, i) => {
          const dup = Boolean(it.type) && exams.some((e) => e.exam_type_id === it.type.id && e.prescribed_date === date);
          return { key: i, label: it.description, sub: [it.code && `cod. ${it.code}`, it.access].filter(Boolean).join(" · "),
                   code: it.code || "", unit: it.type?.unit || "", typeId: it.type ? String(it.type.id) : "",
                   selected: Boolean(it.type) && !dup, duplicate: dup, newName: shortName(it.description), newCategory: "Importati" };
        }));
      } else {
        const r = parseReport(pages);
        const matched = matchReport(r, activeTypes);
        if (!matched.length) {
          throw new Error("Nessun risultato riconosciuto. Se è una foto, riprova con più luce, il foglio dritto e tutta la pagina inquadrata.");
        }
        const reportDate = r.reportDate || todayIso();
        setDoc({ kind: "referto", source, fileNames, taxCodes: r.taxCodes, reportDate, sampled: r.sampledDate || "" });
        setRows(matched.map((m, i) => {
          const dup = Boolean(m.type) && exams.some((e) => e.exam_type_id === m.type.id && e.result_date === reportDate
                                                          && String(e.result_value || "") === String(m.value));
          return { key: i, label: m.name, sub: [m.section, m.group].filter(Boolean).join(" › "),
                   value: m.value, unit: m.unit || "", range: m.range || "", flag: m.outOfRange ?? null,
                   panel: Boolean(m.panel), children: m.children || 0, code: "",
                   typeId: m.type ? String(m.type.id) : "", selected: Boolean(m.type) && !dup, duplicate: dup,
                   newName: m.name, newCategory: m.section ? sentence(m.section) : "Importati" };
        }));
      }
      setStatus(null);
    } catch (err) {
      console.error(err);
      setStatus({ error: err.message || String(err) });
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const created = {};
      for (const r of selected.filter((x) => x.typeId === NEW_TYPE)) {
        const res = await api.post("/api/admin/exam-types", {
          name: r.newName.trim(), category: r.newCategory.trim() || "Importati", unit: r.unit || "",
          code: r.code || "", aliases: r.label,
        });
        created[r.key] = res.id;
      }
      const typeOf = (r) => (r.typeId === NEW_TYPE ? created[r.key] : Number(r.typeId));
      const label = SOURCE_LABEL[doc.source] || doc.source;
      let message;
      if (doc.kind === "prescrizione") {
        const items = selected.map((r) => ({
          exam_type_id: typeOf(r), prescribed_date: doc.date, expected_date: doc.expected || null, status: "da_effettuare",
          result_unit: meta.examTypesById.get(typeOf(r))?.unit || r.unit || "", notes: doc.notes,
          source: `Ricetta importata da ${label}`,
        }));
        await addExams(keys, p.id, items);
        logEvent("importa_prescrizione", p.code, `${items.length} esami da ${label}`);
        message = `${items.length} esami prescritti importati.`;
      } else {
        const used = new Set();
        const fresh = [];
        let completed = 0;
        const source = `Referto importato da ${label} del ${itDate(doc.reportDate)}`;
        for (const r of selected) {
          const typeId = typeOf(r);
          const data = { result_value: r.value.trim(), result_unit: r.unit || null, reference_range: r.range || null,
                         out_of_range: r.flag, result_date: doc.reportDate, status: "risultato", source };
          const open = r.typeId === NEW_TYPE ? null : findOpenExam(exams, typeId, used);
          if (open) {
            used.add(open.id);
            await updateExam(keys, open.id, { ...open, ...data, delivered_date: open.delivered_date || doc.sampled || doc.reportDate });
            completed += 1;
          } else {
            fresh.push({ exam_type_id: typeId, prescribed_date: doc.sampled || doc.reportDate, expected_date: null,
                         delivered_date: doc.sampled || doc.reportDate, notes: "", ...data });
          }
        }
        if (fresh.length) await addExams(keys, p.id, fresh);
        logEvent("importa_referto", p.code, `${completed} completati, ${fresh.length} nuovi, da ${label}`);
        message = `Referto importato: ${completed} esami prescritti completati, ${fresh.length} nuovi risultati.`;
      }
      if (Object.keys(created).length) await reloadMeta();
      await reloadVault();
      flash(message);
      navigate(`/pazienti/${p.code}#esami`);
    } catch (err) {
      flash(err.message || String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const ownerBox = () => {
    if (owner === "ok") return <div className="flash flash-success">✓ Codice fiscale del documento uguale a quello del paziente.</div>;
    const text = {
      diverso: <>⚠ <strong>Il codice fiscale del documento ({doc.taxCodes.join(", ")}) è diverso da quello del paziente
        ({patientCf}).</strong> Probabilmente il documento è di un'altra persona.</>,
      simile: <>Il codice fiscale letto ({doc.taxCodes.join(", ")}) non è valido e somiglia a quello del paziente ({patientCf}):
        probabilmente è un errore di lettura della foto. Verifica il documento.</>,
      assente: <>Nel documento non è stato trovato un codice fiscale: verifica tu che sia di questo paziente.</>,
      "senza-cf": <>Il paziente non ha il codice fiscale in anagrafica: verifica tu che il documento sia suo
        {doc.taxCodes.length ? ` (CF nel documento: ${doc.taxCodes.join(", ")})` : ""}.</>,
      riservato: <>Non hai il permesso di vedere l'anagrafica, quindi non è possibile confrontare il codice fiscale: verifica tu
        che il documento sia del paziente {p.code}.</>,
    }[owner];
    return (
      <div className={`flash ${owner === "diverso" ? "flash-error" : "flash-warning"}`}>
        {text}
        <label className="check owner-check">
          <input type="checkbox" checked={ownerOk} onChange={(e) => setOwnerOk(e.target.checked)} />
          {" "}Confermo che il documento è del paziente {p.code}
        </label>
      </div>
    );
  };

  const action = (r) => {
    if (r.duplicate && !r.selected) return <span className="muted">Già presente</span>;
    if (!r.selected || !r.typeId) return <span className="muted">—</span>;
    const open = plan.get(r.key);
    if (open) return <span className="badge b-done">Completa la prescrizione del {itDate(open.prescribed_date)}</span>;
    return <span className="badge b-todo">{doc.kind === "referto" ? "Nuovo risultato" : "Nuova prescrizione"}</span>;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="back" to={`/pazienti/${p.code}#esami`}>← Scheda {p.code}</Link>
          <h1>Importa prescrizione o referto</h1>
          <div className="tags">
            <span className="code">{p.code}</span>
            {p.identity && <span className="pname small">{p.identity.last_name} {p.identity.first_name}</span>}
          </div>
        </div>
      </div>

      <section className="card import-pick">
        <label className="file-pick">
          <input type="file" accept="application/pdf,.pdf,image/*" multiple onChange={onFiles} disabled={status?.busy || saving} />
          <span className="btn primary">📄 Scegli PDF o foto…</span>
        </label>
        <p className="hint">
          <strong>PDF</strong> (promemoria della ricetta elettronica o referto del laboratorio): letto direttamente in questo browser.<br />
          <strong>Foto</strong> (una per pagina, foglio dritto e ben illuminato){cfg.ocr_available
            ? <>: il testo viene riconosciuto dal PC server dell'unità, in memoria, senza salvare l'immagine.</>
            : <>: <em>non disponibile</em>, sul PC server manca Tesseract OCR (vedi README).</>}
        </p>
        {status?.busy && <p className="form-status busy">⏳ {status.text}</p>}
        {status?.error && <p className="form-status error">⚠️ {status.error}</p>}
      </section>

      {doc && (
        <section className="card">
          <h2>{doc.kind === "prescrizione" ? "Prescrizione" : "Referto di laboratorio"} <span className="muted">· {doc.fileNames}</span></h2>
          {ownerBox()}
          {doc.source !== "pdf" && (
            <div className="flash flash-warning">
              Testo letto da {SOURCE_LABEL[doc.source]}: <strong>controlla ogni valore</strong> (l'OCR può sbagliare virgole e cifre).
            </div>
          )}

          {doc.kind === "prescrizione" ? (
            <div className="form-grid">
              <label>Data prescrizione<input type="date" value={doc.date} onChange={setDocField("date")} required /></label>
              <label>Data prevista di esecuzione<input type="date" value={doc.expected} onChange={setDocField("expected")} />
                {doc.priority && <small className="muted">da priorità: {doc.priority}</small>}
              </label>
              <label className="span-3">Note (copiate su ogni esame)<input value={doc.notes} onChange={setDocField("notes")} /></label>
            </div>
          ) : (
            <div className="form-grid">
              <label>Data prelievo<input type="date" value={doc.sampled} onChange={setDocField("sampled")} /></label>
              <label>Data referto<input type="date" value={doc.reportDate} onChange={setDocField("reportDate")} required /></label>
            </div>
          )}

          <div className="table-wrap">
            <table className="table import-table">
              <thead>
                <tr>
                  <th />
                  <th>Nel documento</th>
                  {doc.kind === "referto" && <><th>Valore</th><th>Unità</th><th>Riferimento</th></>}
                  <th>Tipo di esame</th>
                  <th>Cosa succede</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={`${r.selected && r.typeId ? "" : "row-skip"}${r.flag ? " row-flag" : ""}`}>
                    <td>
                      <input type="checkbox" checked={r.selected && Boolean(r.typeId)} disabled={!r.typeId}
                             aria-label={`Importa ${r.label}`}
                             onChange={(e) => setRow(r.key, { selected: e.target.checked })} />
                    </td>
                    <td>
                      <strong>{r.label}</strong>
                      {r.panel && <span className="badge b-muted"> {r.children} valori</span>}
                      {r.sub && <div className="sub">{r.sub}</div>}
                    </td>
                    {doc.kind === "referto" && (
                      <>
                        <td className="value-cell">
                          <input value={r.value} onChange={(e) => setRow(r.key, { value: e.target.value })}
                                 className={r.panel ? "wide" : undefined} aria-label={`Valore ${r.label}`} />
                          {r.flag && <span className="out-of-range" title="Fuori dall'intervallo di riferimento"> ⚠</span>}
                        </td>
                        <td>{r.unit}</td>
                        <td className="sub">{r.range}</td>
                      </>
                    )}
                    <td>
                      <TypeSelect value={r.typeId} types={activeTypes} canCreate={user.is_admin}
                                  onChange={(v) => setRow(r.key, { typeId: v, selected: Boolean(v) })} />
                      {r.typeId === NEW_TYPE && (
                        <div className="new-type">
                          <input value={r.newName} onChange={(e) => setRow(r.key, { newName: e.target.value })} placeholder="Nome del nuovo esame" />
                          <input value={r.newCategory} onChange={(e) => setRow(r.key, { newCategory: e.target.value })} placeholder="Categoria" />
                        </div>
                      )}
                    </td>
                    <td>{action(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            Le righe senza tipo di esame non vengono importate: scegline uno dal menu
            {user.is_admin ? " oppure creane uno nuovo" : " (un amministratore può aggiungere nuovi tipi nei Cataloghi)"}.
            {doc.kind === "referto" && " Se per lo stesso esame c'è una prescrizione ancora aperta, viene completata con il risultato."}
          </p>
          <div className="actions">
            <button type="button" className="btn primary" disabled={!canSave} onClick={save}>
              {saving ? "Importazione…" : `Importa ${selected.length} ${selected.length === 1 ? "esame" : "esami"}`}
            </button>
            <Link className="btn ghost" to={`/pazienti/${p.code}#esami`}>Annulla</Link>
          </div>
        </section>
      )}
    </>
  );
}
