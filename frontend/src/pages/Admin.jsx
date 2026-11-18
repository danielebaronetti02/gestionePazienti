// Amministrazione: utenti e permessi, cataloghi, registro accessi.
import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../appContext";
import { Async, Loading } from "../components/common";
import { EMAIL_RE, itDateTime } from "../format";
import { useApi, useForm } from "../hooks";
import { Link, useRouter } from "../router";
import { credentialsForUser, grantsFor } from "../vault";

// ---------------------------------------------------------------------------
// Utenti
// ---------------------------------------------------------------------------
function AccessBadge({ u }) {
  if (!u.active) return <span className="badge b-muted">Disattivato</span>;
  if (u.temp_expired) return <span className="badge b-overdue">Password temporanea scaduta</span>;
  if (u.must_change_pw) return <span className="badge b-todo">In attesa del primo accesso</span>;
  return <span className="badge b-done">Attivo</span>;
}

async function confirmAndDelete(u, flash) {
  const ok = window.confirm(
    `Eliminare definitivamente l'utente ${u.full_name} (${u.email})?\n\n`
    + "Non potrà più accedere. Pazienti, esami e visite che ha inserito restano nell'archivio.");
  if (!ok) return false;
  try {
    await api.del(`/api/admin/users/${u.id}`);
    flash(`Utente ${u.full_name} eliminato.`);
    return true;
  } catch (err) {
    flash(err.message, "error");
    return false;
  }
}

/** Riquadro con la password temporanea appena generata: è l'unica occasione per vederla. */
function TempPasswordBox({ info, hours, onDone }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="card narrow temp-box">
      <h2>{info.title}</h2>
      <p>Comunica queste credenziali a <strong>{info.name}</strong> (di persona o per telefono):</p>
      <table className="table compact">
        <tbody>
          <tr><th>Email</th><td className="mono">{info.email}</td></tr>
          <tr><th>Password temporanea</th><td><span className="mono temp-password">{info.password}</span></td></tr>
        </tbody>
      </table>
      <p className="hint">
        ⚠️ Questa password viene mostrata <strong>una sola volta</strong> e non è salvata da nessuna parte.
        Vale {hours} ore: al primo accesso l'utente dovrà sceglierne una personale.
        Se la perdi, imposta una nuova password temporanea dalla scheda dell'utente.
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick={copy}>{copied ? "✓ Copiata" : "📋 Copia password"}</button>
        <button type="button" className="btn primary" onClick={onDone}>Fatto, torna agli utenti</button>
      </div>
    </div>
  );
}

export function UsersPage() {
  const { user, flash } = useApp();
  const state = useApi("/api/admin/users");
  const [busyId, setBusyId] = useState(null);

  const remove = async (u) => {
    setBusyId(u.id);
    if (await confirmAndDelete(u, flash)) state.reload();
    setBusyId(null);
  };

  return (
    <>
      <div className="page-head">
        <h1>Utenti e autorizzazioni</h1>
        <Link className="btn primary" to="/admin/utenti/nuovo">+ Nuovo utente</Link>
      </div>
      <Async state={state}>
        {(users) => (
          <div className="card flush table-wrap">
            <table className="table">
              <thead>
                <tr><th>Nome</th><th>Email</th><th>Ruolo</th><th>Vede anagrafica</th><th>Stato</th><th>Ultimo accesso</th><th /></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.active ? undefined : "row-archived"}>
                    <td><strong>{u.full_name}</strong>{u.id === user.id && <span className="muted"> (tu)</span>}</td>
                    <td className="mono">{u.email}</td>
                    <td>{u.role_label}</td>
                    <td>{u.can_view_identity ? "Sì" : "No (solo codice)"}</td>
                    <td><AccessBadge u={u} /></td>
                    <td>{itDateTime(u.last_login)}</td>
                    <td className="right nowrap">
                      <Link className="btn small" to={`/admin/utenti/${u.id}`}>Modifica</Link>{" "}
                      {u.id !== user.id && (
                        <button type="button" className="btn small danger" disabled={busyId === u.id} onClick={() => remove(u)}>
                          Elimina
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      <div className="card legend-box">
        <h3>Ruoli e chiavi</h3>
        <ul>
          <li><strong>Amministratore</strong>: tutto quello che fa un medico, più vedere, aggiungere, modificare ed eliminare utenti, cataloghi e registro accessi.</li>
          <li><strong>Medico</strong>: crea e modifica schede, prescrive e aggiorna esami, registra visite.</li>
          <li><strong>Sola consultazione</strong>: legge schede ed esami senza modificarli.</li>
        </ul>
        <p>
          Chi non ha <strong>“Vede anagrafica”</strong> non riceve la chiave dell'anagrafica: vede i pazienti solo tramite codice.
          Se un utente dimentica la password, aprilo con <strong>Modifica</strong> e imposta una nuova password temporanea.
          Tenete <strong>almeno due amministratori</strong>: se l'unico amministratore perde la password, nessuno può reimpostarla.
        </p>
      </div>
    </>
  );
}

export function UserFormPage({ params }) {
  const isNew = !params.id;
  const { cfg, meta, keys, user, flash } = useApp();
  const { navigate } = useRouter();
  const [u, setU] = useState(null);                 // utente esistente (con chiave pubblica)
  const [f, bind, setF] = useForm(isNew ? { full_name: "", email: "", role: "medico", can_view_identity: true, active: true } : null);
  const [status, setStatus] = useState(null);       // { busy, text } oppure { error }
  const [issued, setIssued] = useState(null);       // password temporanea appena generata
  const busy = Boolean(status?.busy);

  useEffect(() => {
    if (isNew) return;
    api.get(`/api/admin/users/${params.id}`).then((x) => {
      setU(x);
      setF({ full_name: x.full_name, email: x.email, role: x.role, can_view_identity: x.can_view_identity, active: x.active });
    }).catch((e) => flash(e.message, "error"));
  }, [isNew, params.id, setF, flash]);

  if (issued) return <TempPasswordBox info={issued} hours={cfg.temp_password_hours} onDone={() => navigate("/admin/utenti")} />;
  if (!f) return <Loading />;

  const isSelf = !isNew && u && u.id === user.id;

  const fail = (err) => {
    console.error(err);
    const message = err?.message || String(err);
    setStatus({ error: message });
    flash(message, "error");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    try {
      if (isNew) {
        const email = f.email.trim().toLowerCase();
        if (!EMAIL_RE.test(email)) throw new Error("Indirizzo email non valido.");
        if (!keys?.clinical) throw new Error("Il tuo archivio non è sbloccato: esci e rientra.");
        setStatus({ busy: true, text: "Preparazione delle chiavi del nuovo utente…" });
        const { material, tempPassword } = await credentialsForUser(cfg, keys, email, f.can_view_identity);
        setStatus({ busy: true, text: "Creazione dell'account…" });
        await api.post("/api/admin/users", { ...f, email, ...material });
        setStatus(null);
        setIssued({ title: "Account creato", name: f.full_name, email, password: tempPassword });
        return;
      }
      setStatus({ busy: true, text: "Salvataggio…" });
      const body = { full_name: f.full_name, role: f.role, can_view_identity: f.can_view_identity, active: f.active };
      const needsIdentity = f.can_view_identity && !u.granted.includes("identity") && u.granted.includes("clinical");
      if (needsIdentity) body.grants = { identity: (await grantsFor(u.public_key, keys, true)).identity };
      await api.put(`/api/admin/users/${u.id}`, body);
      setStatus(null);
      flash("Utente salvato.");
      navigate("/admin/utenti");
    } catch (err) {
      fail(err);
    }
  };

  const newTempPassword = async () => {
    if (busy || !window.confirm(`Impostare una nuova password temporanea per ${u.full_name}? Quella attuale smetterà di funzionare.`)) return;
    try {
      setStatus({ busy: true, text: "Generazione della nuova password temporanea…" });
      const { material, tempPassword } = await credentialsForUser(cfg, keys, u.email, u.can_view_identity);
      await api.post(`/api/admin/users/${u.id}/reset-password`, material);
      setStatus(null);
      setIssued({ title: "Nuova password temporanea", name: u.full_name, email: u.email, password: tempPassword });
    } catch (err) {
      fail(err);
    }
  };

  const remove = async () => {
    if (await confirmAndDelete(u, flash)) navigate("/admin/utenti");
  };

  return (
    <>
      <div className="page-head">
        <h1>{isNew ? "Nuovo utente" : "Modifica utente"}</h1>
        <Link className="btn ghost" to="/admin/utenti">Annulla</Link>
      </div>
      <form className="card narrow" onSubmit={submit}>
        <label>Nome e cognome *<input value={f.full_name} onChange={bind("full_name")} required /></label>
        <label>Email *
          <input type="email" value={f.email} onChange={bind("email")} required disabled={!isNew} autoComplete="off"
                 placeholder="nome.cognome@esempio.it" />
          {!isNew && <small className="muted">L'email non si può cambiare: è legata alle chiavi di cifratura dell'utente.</small>}
        </label>
        <label>Ruolo
          <select value={f.role} onChange={bind("role")} disabled={isSelf}>
            {Object.entries(meta.roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={f.can_view_identity} onChange={bind("can_view_identity")} /> Può vedere i dati anagrafici</label>
        <label className="check"><input type="checkbox" checked={f.active} onChange={bind("active")} disabled={isSelf} /> Account attivo</label>
        {isSelf && <small className="muted">Non puoi cambiare il tuo ruolo né disattivare il tuo account.</small>}
        {isNew && (
          <p className="hint">
            🔑 Al salvataggio viene generata una <strong>password temporanea</strong> (valida {cfg.temp_password_hours} ore)
            che vedrai <strong>una sola volta</strong> sullo schermo: comunicala all'utente. Al primo accesso dovrà sceglierne una personale.
          </p>
        )}
        <div className="actions">
          <button type="submit" className="btn primary" disabled={busy}>{isNew ? "Crea utente" : "Salva"}</button>
        </div>
        {status?.busy && <p className="form-status busy">⏳ {status.text}</p>}
        {status?.error && <p className="form-status error">⚠️ {status.error}</p>}
      </form>

      {!isNew && u && !isSelf && (
        <>
          <div className="card narrow">
            <h3>Password</h3>
            <p className="muted">
              Se l'utente ha dimenticato la password o quella temporanea è scaduta, imposta una nuova password temporanea:
              la vedrai a schermo e dovrai comunicargliela. Le sue chiavi vengono rigenerate e l'accesso ai dati resta abilitato.
            </p>
            <button type="button" className="btn" disabled={busy || !f.active} onClick={newTempPassword}>
              🔑 Imposta nuova password temporanea
            </button>
          </div>
          <div className="card narrow">
            <h3>Elimina utente</h3>
            <p className="muted">
              L'account viene cancellato e l'utente non potrà più accedere. Pazienti, esami e visite che ha inserito restano nell'archivio.
              Se vuoi solo sospenderlo, togli la spunta “Account attivo”.
            </p>
            <button type="button" className="btn danger" disabled={busy} onClick={remove}>🗑 Elimina utente</button>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Cataloghi
// ---------------------------------------------------------------------------
function ExamTypeRow({ t, uses, onChange, onDelete }) {
  const [f, setF] = useState({ category: t.category, unit: t.unit || "", code: t.code || "", aliases: (t.aliases || "").replaceAll("|", ", ") });
  const [open, setOpen] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <tr className={t.active ? undefined : "row-archived"}>
        <td>
          <strong>{t.name}</strong>
          <div className="sub">{t.category}{t.unit ? ` · ${t.unit}` : ""}{t.code ? ` · cod. ${t.code}` : ""}</div>
        </td>
        <td>{uses}</td>
        <td className="right nowrap">
          <button type="button" className="btn small ghost" onClick={() => setOpen(!open)}>{open ? "Chiudi" : "Modifica"}</button>{" "}
          <button type="button" className="btn small ghost" onClick={() => onChange(t.id, { active: !t.active })}>
            {t.active ? "Disattiva" : "Riattiva"}
          </button>{" "}
          <button type="button" className="btn small danger" disabled={uses > 0} onClick={() => onDelete(t)}
                  title={uses > 0 ? `Usato da ${uses} esami: puoi solo disattivarlo` : "Elimina dal catalogo"}>
            Elimina
          </button>
        </td>
      </tr>
      {open && (
        <tr className="row-edit">
          <td colSpan={3}>
            <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onChange(t.id, f); setOpen(false); }}>
              <label>Categoria<input value={f.category} onChange={set("category")} /></label>
              <label>Unità<input value={f.unit} onChange={set("unit")} /></label>
              <label>Codice nomenclatore<input value={f.code} onChange={set("code")} placeholder="es. 90.42.1" /></label>
              <label className="span-3">Sinonimi (per riconoscerlo nei referti, separati da virgola)
                <input value={f.aliases} onChange={set("aliases")} placeholder="es. glucosio, glicemia a digiuno" />
              </label>
              <div className="actions"><button className="btn small primary">Salva</button></div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

export function CatalogsPage() {
  const { flash, reloadMeta, vault } = useApp();
  const state = useApi("/api/admin/catalogs");
  const [newPath, setNewPath] = useState("");
  const [newExam, setNewExam] = useState({ name: "", category: "", unit: "", code: "" });
  const [filter, setFilter] = useState("");

  // quante volte è usata ogni voce: lo sa solo il browser (i dati clinici sul server sono cifrati)
  const pathologyUses = new Map();
  for (const p of vault.patients) pathologyUses.set(p.clinical.pathology_id, (pathologyUses.get(p.clinical.pathology_id) || 0) + 1);
  const examUses = new Map();
  for (const e of vault.exams) examUses.set(e.exam_type_id, (examUses.get(e.exam_type_id) || 0) + 1);
  const undecryptable = vault.patients.some((p) => p.error) || vault.exams.some((e) => e.error);

  const act = async (fn, after, message = "Catalogo aggiornato.") => {
    try {
      await fn();
      flash(message);
      after?.();
      state.reload();
      reloadMeta();
    } catch (err) {
      flash(err.message, "error");
    }
  };
  const remove = (kind, item) => {
    if (undecryptable) { flash("Alcuni dati non sono decifrabili: impossibile verificare che la voce non sia usata.", "error"); return; }
    if (!window.confirm(`Eliminare definitivamente “${item.name}” dal catalogo?`)) return;
    act(() => api.del(`/api/admin/${kind}/${item.id}`), null, `“${item.name}” eliminato dal catalogo.`);
  };
  const match = (text) => !filter || text.toLowerCase().includes(filter.toLowerCase());

  return (
    <>
      <h1>Cataloghi</h1>
      <p className="muted">
        Le voci <strong>disattivate</strong> non compaiono più nei menu di scelta ma restano sui pazienti ed esami già registrati.
        Si possono <strong>eliminare</strong> solo le voci mai usate.
      </p>
      <Async state={state}>
        {(c) => (
          <div className="grid-2">
            <section className="card">
              <h2>Patologie</h2>
              <table className="table compact">
                <thead><tr><th>Nome</th><th>Pazienti</th><th /></tr></thead>
                <tbody>
                  {c.pathologies.map((p) => {
                    const uses = pathologyUses.get(p.id) || 0;
                    return (
                      <tr key={p.id} className={p.active ? undefined : "row-archived"}>
                        <td>{p.name}</td>
                        <td>{uses}</td>
                        <td className="right nowrap">
                          <button type="button" className="btn small ghost"
                                  onClick={() => act(() => api.patch(`/api/admin/pathologies/${p.id}`, { active: !p.active }))}>
                            {p.active ? "Disattiva" : "Riattiva"}
                          </button>{" "}
                          <button type="button" className="btn small danger" disabled={uses > 0} onClick={() => remove("pathologies", p)}
                                  title={uses > 0 ? `Assegnata a ${uses} pazienti: puoi solo disattivarla` : "Elimina dal catalogo"}>
                            Elimina
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <form className="inline-form"
                    onSubmit={(e) => { e.preventDefault(); act(() => api.post("/api/admin/pathologies", { name: newPath }), () => setNewPath("")); }}>
                <input value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="Nuova patologia" required />
                <button className="btn">Aggiungi</button>
              </form>
            </section>

            <section className="card">
              <h2>Esami prescrivibili</h2>
              <input className="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Cerca esame…" />
              <table className="table compact">
                <thead><tr><th>Esame</th><th>Usi</th><th /></tr></thead>
                <tbody>
                  {c.exam_types.filter((t) => match(`${t.name} ${t.category} ${t.aliases || ""} ${t.code || ""}`)).map((t) => (
                    <ExamTypeRow key={`${t.id}-${t.category}-${t.unit}-${t.active}-${t.code}-${t.aliases}`} t={t}
                                 uses={examUses.get(t.id) || 0}
                                 onChange={(id, body) => act(() => api.patch(`/api/admin/exam-types/${id}`, body))}
                                 onDelete={(x) => remove("exam-types", x)} />
                  ))}
                </tbody>
              </table>
              <form className="inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      act(() => api.post("/api/admin/exam-types", newExam), () => setNewExam({ name: "", category: "", unit: "", code: "" }));
                    }}>
                <input value={newExam.name} onChange={(e) => setNewExam({ ...newExam, name: e.target.value })} placeholder="Nome esame" required />
                <input value={newExam.category} onChange={(e) => setNewExam({ ...newExam, category: e.target.value })} placeholder="Categoria" size={14} />
                <input value={newExam.unit} onChange={(e) => setNewExam({ ...newExam, unit: e.target.value })} placeholder="Unità" size={6} />
                <input value={newExam.code} onChange={(e) => setNewExam({ ...newExam, code: e.target.value })} placeholder="Codice" size={8} />
                <button className="btn">Aggiungi</button>
              </form>
            </section>
          </div>
        )}
      </Async>
    </>
  );
}

// ---------------------------------------------------------------------------
// Registro accessi
// ---------------------------------------------------------------------------
export function AuditPage() {
  const { query, navigate } = useRouter();
  const q = query.get("q") || "";
  const [text, setText] = useState(q);
  const state = useApi("/api/admin/audit", { q });

  return (
    <>
      <div className="page-head"><h1>Registro accessi e modifiche</h1></div>
      <form className="filters card"
            onSubmit={(e) => { e.preventDefault(); navigate(text ? `/admin/registro?q=${encodeURIComponent(text)}` : "/admin/registro", { replace: true }); }}>
        <label className="grow">Filtra per utente, codice paziente o azione<input value={text} onChange={(e) => setText(e.target.value)} /></label>
        <button className="btn">Filtra</button>
      </form>
      <Async state={state}>
        {(rows) => (
          <div className="card flush table-wrap">
            <table className="table compact">
              <thead><tr><th>Data/ora</th><th>Utente</th><th>Azione</th><th>Paziente</th><th>Dettagli</th><th>IP</th></tr></thead>
              <tbody>
                {rows.length ? rows.map((r) => (
                  <tr key={r.id} className={r.action === "login_fallito" ? "row-overdue" : undefined}>
                    <td className="nowrap">{itDateTime(r.ts)}</td>
                    <td className="mono">{r.username || "—"}</td>
                    <td>{r.action.replaceAll("_", " ")}</td>
                    <td>{r.patient_code && <Link className="code" to={`/pazienti/${r.patient_code}`}>{r.patient_code}</Link>}</td>
                    <td>{r.details || ""}</td>
                    <td className="mono muted">{r.ip || ""}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="empty">Nessuna voce.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      <p className="hint">Mostrate le ultime 500 voci. Il registro completo è nella tabella <code>audit_log</code> del database.</p>
    </>
  );
}

export function NotFoundPage() {
  return (
    <div className="card narrow">
      <h1>Pagina non trovata</h1>
      <p>La pagina richiesta non esiste.</p>
      <Link className="btn" to="/">Torna alla dashboard</Link>
    </div>
  );
}

