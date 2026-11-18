// Piccoli componenti condivisi: badge di stato, cella paziente, stati di caricamento.
import { Link } from "../router";

export function StatusBadge({ exam }) {
  if (exam.overdue) return <span className="badge b-overdue">In ritardo</span>;
  if (exam.status === "da_effettuare") return <span className="badge b-todo">Da effettuare</span>;
  if (exam.status === "consegnato") return <span className="badge b-wait">Consegnato · attesa risultato</span>;
  return <span className="badge b-done">Risultato disponibile</span>;
}

export function PatientCell({ code, name }) {
  return (
    <>
      <Link className="code" to={`/pazienti/${code}`}>
        {code}
      </Link>
      {name && <div className="sub">{name}</div>}
    </>
  );
}

export function Loading({ text = "Caricamento…" }) {
  return <p className="empty">{text}</p>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="flash flash-error">{error.message}</div>;
}

/** Mostra caricamento/errore finché i dati non sono pronti. */
export function Async({ state, children }) {
  if (state.error) return <ErrorBox error={state.error} />;
  if (state.loading || !state.data) return <Loading />;
  return children(state.data);
}

export function Count({ n }) {
  return <span className="count">{n}</span>;
}

/** Pulsante che chiede conferma prima di eseguire l'azione. */
export function ConfirmButton({ message, onConfirm, className = "btn", children, ...rest }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (window.confirm(message)) onConfirm();
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
