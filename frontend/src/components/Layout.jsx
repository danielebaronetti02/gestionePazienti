import { useApp } from "../appContext";
import { Link, useRouter } from "../router";

function NavLink({ to, active, children }) {
  return (
    <Link to={to} className={active ? "active" : undefined}>
      {children}
    </Link>
  );
}

export function Layout({ children, messages, onDismiss, showNav }) {
  const { user, logout } = useApp();
  const { pathname } = useRouter();
  const starts = (p) => pathname === p || pathname.startsWith(p + "/");

  return (
    <>
      {user && (
        <header className="topbar">
          <Link className="brand" to="/">
            <span className="brand-mark">GP</span> Gestione Pazienti
          </Link>
          {showNav && !user.must_change_pw && (
            <nav className="mainnav">
              <NavLink to="/" active={pathname === "/"}>Dashboard</NavLink>
              <NavLink to="/pazienti" active={starts("/pazienti")}>Pazienti</NavLink>
              <NavLink to="/esami" active={starts("/esami")}>Esami</NavLink>
              {user.can_edit && <NavLink to="/esporta" active={starts("/esporta")}>Esporta</NavLink>}
              {user.is_admin && (
                <>
                  <NavLink to="/admin/utenti" active={starts("/admin/utenti")}>Utenti</NavLink>
                  <NavLink to="/admin/cataloghi" active={starts("/admin/cataloghi")}>Cataloghi</NavLink>
                  <NavLink to="/admin/registro" active={starts("/admin/registro")}>Registro accessi</NavLink>
                </>
              )}
            </nav>
          )}
          <div className="usermenu">
            <span className="who">
              {user.full_name}{" "}
              <small>
                {user.role_label}
                {!user.can_view_identity && " · dati pseudonimizzati"}
              </small>
            </span>
            {showNav && <Link to="/password">Password</Link>}
            <button type="button" className="linklike" onClick={logout}>
              Esci
            </button>
          </div>
        </header>
      )}
      <main className="container">
        {messages.map((m) => (
          <div key={m.id} className={`flash flash-${m.type}`}>
            {m.text}
            <button type="button" className="flash-close" aria-label="Chiudi" onClick={() => onDismiss(m.id)}>
              ×
            </button>
          </div>
        ))}
        {children}
      </main>
    </>
  );
}
