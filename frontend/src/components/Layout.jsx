import { useEffect, useRef, useState } from "react";
import { useApp } from "../appContext";
import { Link, useRouter } from "../router";
import { getThemeChoice, setThemeChoice } from "../theme";

const THEMES = [["chiaro", "☀️ Giorno"], ["scuro", "🌙 Notte"], ["auto", "Automatico"]];

/** Menu dell'account: si apre cliccando sul nome. */
function UserMenu({ user, showNav, logout }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(getThemeChoice);
  const box = useRef(null);
  const { pathname } = useRouter();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);

  const chooseTheme = (t) => { setThemeChoice(t); setTheme(t); };
  const initials = user.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

  return (
    <div className="usermenu" ref={box}>
      <button type="button" className="who" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="avatar" aria-hidden="true">{initials}</span>
        <span className="who-text">
          {user.full_name}
          <small>{user.role_label}{!user.can_view_identity && " · dati pseudonimizzati"}</small>
        </span>
        <span className="caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <strong>{user.full_name}</strong>
            <span>{user.email}</span>
          </div>
          {showNav && <Link role="menuitem" className="menu-item" to="/password">🔑 Modifica password</Link>}
          <div className="menu-section" role="group" aria-label="Tema">
            <span className="menu-label">Tema</span>
            <div className="theme-switch">
              {THEMES.map(([k, label]) => (
                <button key={k} type="button" role="menuitemradio" aria-checked={theme === k}
                        className={theme === k ? "on" : undefined} onClick={() => chooseTheme(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" role="menuitem" className="menu-item danger" onClick={logout}>⎋ Esci</button>
        </div>
      )}
    </div>
  );
}

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
          <UserMenu user={user} showNav={showNav} logout={logout} />
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
