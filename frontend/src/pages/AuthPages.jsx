// Accesso con email, sblocco dell'archivio, cambio password.
import { useState } from "react";
import { useApp } from "../appContext";
import { EMAIL_RE } from "../format";
import { passwordProblem } from "../passwordPolicy";
import { useAction, useForm } from "../hooks";
import { useRouter } from "../router";
import { changePassword, loginWithPassword, refreshGrants, unlockWithPassword, WrongPassword } from "../vault";

function Brand() {
  return (
    <div className="brand big">
      <span className="brand-mark">GP</span> Gestione Pazienti
    </div>
  );
}


function emailProblem(email) {
  return EMAIL_RE.test(email.trim()) ? null : "Indirizzo email non valido.";
}

// ---------------------------------------------------------------------------
export function LoginPage() {
  const { cfg, signedIn } = useApp();
  const [f, bind] = useForm({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, run] = useAction();

  const submit = (e) => {
    e.preventDefault();
    const problem = emailProblem(f.email);
    if (problem) return setError(problem);
    setError(null);
    run(async () => {
      try {
        const { user, keys } = await loginWithPassword(cfg, f.email.trim().toLowerCase(), f.password);
        signedIn(user, keys);
      } catch (err) {
        setError(err.message);
      }
    });
  };

  return (
    <div className="login-box card">
      <Brand />
      <p className="muted">Accesso riservato al personale autorizzato dell'unità.</p>
      {error && <div className="flash flash-error">{error}</div>}
      <form onSubmit={submit}>
        <label>
          Email
          <input type="email" value={f.email} onChange={bind("email")} autoComplete="username" required autoFocus
                 placeholder="nome.cognome@esempio.it" />
        </label>
        <label>
          Password
          <input type="password" value={f.password} onChange={bind("password")} autoComplete="current-password" required />
        </label>
        <button type="submit" className="btn primary full" disabled={busy}>
          {busy ? "Accesso e apertura delle chiavi…" : "Accedi"}
        </button>
      </form>
      <p className="center-link muted">Password dimenticata? Chiedi a un amministratore di impostarne una nuova temporanea.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function UnlockPage() {
  const { cfg, user, signedIn, logout } = useApp();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, run] = useAction();

  const submit = (e) => {
    e.preventDefault();
    setError(null);
    run(async () => {
      try {
        signedIn(user, await unlockWithPassword(cfg, user, password));
      } catch (err) {
        setError(err instanceof WrongPassword ? "Password non corretta." : err.message);
        setPassword("");
      }
    });
  };

  return (
    <div className="login-box card">
      <Brand />
      <h2>Sblocca l'archivio</h2>
      <p className="muted">
        Sei collegato come <strong>{user.email}</strong>. Per motivi di sicurezza le chiavi dei dati non vengono conservate:
        inserisci la password per decifrare l'archivio.
      </p>
      {error && <div className="flash flash-error">{error}</div>}
      <form onSubmit={submit}>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus />
        </label>
        <button type="submit" className="btn primary full" disabled={busy}>{busy ? "Apertura…" : "Sblocca"}</button>
      </form>
      <p className="center-link"><button type="button" className="linklike" onClick={logout}>Esci e accedi con un altro account</button></p>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function ChangePasswordPage() {
  const { cfg, user, signedIn, flash } = useApp();
  const { navigate } = useRouter();
  const [f, bind, setF] = useForm({ current: "", next: "", confirm: "" });
  const [busy, run] = useAction();
  const firstAdmin = user.is_admin && !user.keys_initialized;

  const submit = (e) => {
    e.preventDefault();
    const problem = passwordProblem(cfg.min_password_len, f.next, f.confirm, user.email) || (f.next === f.current ? "La nuova password deve essere diversa da quella attuale." : null);
    if (problem) return flash(problem, "error");
    run(async () => {
      try {
        const res = await changePassword(cfg, user, f.current, f.next);
        signedIn(res.user, res.keys);
        flash(firstAdmin ? "Password aggiornata e chiavi dell'archivio create." : "Password aggiornata.");
        navigate("/");
      } catch (err) {
        flash(err.message, "error");
        setF({ current: "", next: "", confirm: "" });
      }
    });
  };

  return (
    <>
      <h1>Cambia password</h1>
      {user.must_change_pw && (
        <div className="flash flash-warning">
          Primo accesso: scegli una password personale per continuare.
          {firstAdmin && " Verranno create anche le chiavi di cifratura dell'archivio."}
        </div>
      )}
      <form className="card narrow" onSubmit={submit}>
        <label>Password attuale
          <input type="password" value={f.current} onChange={bind("current")} autoComplete="current-password" required />
        </label>
        <label>Nuova password
          <small className="muted"> (almeno {cfg.min_password_len} caratteri e 3 tipi tra minuscole, maiuscole, numeri e simboli; oppure una frase di 16+ caratteri)</small>
          <input type="password" value={f.next} onChange={bind("next")} minLength={cfg.min_password_len} autoComplete="new-password" required />
        </label>
        <label>Ripeti nuova password
          <input type="password" value={f.confirm} onChange={bind("confirm")} minLength={cfg.min_password_len} autoComplete="new-password" required />
        </label>
        <button className="btn primary" disabled={busy}>{busy ? "Aggiornamento delle chiavi…" : "Salva"}</button>
        <p className="hint">La password protegge anche la tua chiave personale: il server non la conosce e non può recuperarla.</p>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
export function PendingAccessPage() {
  const { user, keys, signedIn, logout, flash } = useApp();
  const [busy, run] = useAction();
  const notInitialized = !user.keys_initialized;

  const retry = () =>
    run(async () => {
      try {
        const k = await refreshGrants(keys.privateKey);
        if (k.clinical) {
          signedIn(user, k);
          flash("Accesso all'archivio abilitato.");
        } else flash("L'accesso non è ancora stato abilitato.", "info");
      } catch (err) {
        flash(err.message, "error");
      }
    });

  return (
    <div className="card narrow">
      <h1>Accesso all'archivio in attesa</h1>
      {notInitialized ? (
        <p>L'archivio non è ancora stato configurato: l'amministratore deve effettuare il primo accesso.</p>
      ) : (
        <p>
          Il tuo account è attivo, ma non hai ancora le chiavi per leggere l'archivio.
          Chiedi a un <strong>amministratore</strong> di impostarti una nuova password temporanea dalla pagina Utenti.
        </p>
      )}
      <div className="btn-row">
        {keys?.privateKey && <button type="button" className="btn primary" onClick={retry} disabled={busy}>Verifica di nuovo</button>}
        <button type="button" className="btn ghost" onClick={logout}>Esci</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Mostrata se il browser non offre la crittografia (pagina aperta via http da un altro PC). */
export function InsecureContextPage() {
  return (
    <div className="card narrow">
      <Brand />
      <h1>Connessione non sicura</h1>
      <p>
        Questo browser blocca la crittografia necessaria a proteggere i dati, perché la pagina è aperta
        con <span className="mono">http://</span> da un altro computer.
      </p>
      <ul>
        <li>Sul PC che ospita il server apri <span className="mono">http://localhost:8000</span>;</li>
        <li>dagli altri PC serve un indirizzo <span className="mono">https://</span> (vedi il README, sezione “Accesso da altri PC”).</li>
      </ul>
    </div>
  );
}
