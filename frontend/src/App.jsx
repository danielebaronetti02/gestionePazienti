// Radice dell'app: accesso, sblocco delle chiavi, archivio decifrato in memoria, scelta della pagina.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, setApiHandlers } from "./api";
import { AppProvider, useFlashState } from "./appContext";
import { Layout } from "./components/Layout";
import { Loading } from "./components/common";
import { clearKeys, loadKeys, saveKeys, touchActivity } from "./crypto/keyCache";
import { indexMeta } from "./domain";
import { AuditPage, CatalogsPage, NotFoundPage, UserFormPage, UsersPage } from "./pages/Admin";
import { ChangePasswordPage, InsecureContextPage, LoginPage, PendingAccessPage, UnlockPage } from "./pages/AuthPages";
import { DashboardPage } from "./pages/Dashboard";
import { ExamEditPage, ExamsPage } from "./pages/Exams";
import { ExportPage } from "./pages/Export";
import { ImportPage } from "./pages/Import";
import { PrintPage } from "./pages/Print";
import { PatientDetailPage } from "./pages/PatientDetail";
import { PatientFormPage } from "./pages/PatientForm";
import { PatientsPage } from "./pages/Patients";
import { matchRoute, useRouter } from "./router";
import { loadVault } from "./vault";

// L'ordine conta: "/pazienti/nuovo" prima di "/pazienti/:code"
const ROUTES = [
  { path: "/", page: DashboardPage },
  { path: "/pazienti", page: PatientsPage },
  { path: "/pazienti/nuovo", page: PatientFormPage, allow: (u) => u.can_edit && u.can_view_identity },
  { path: "/pazienti/:code", page: PatientDetailPage },
  { path: "/pazienti/:code/modifica", page: PatientFormPage, allow: (u) => u.can_edit },
  { path: "/pazienti/:code/importa", page: ImportPage, allow: (u) => u.can_edit },
  { path: "/pazienti/:code/stampa", page: PrintPage },
  { path: "/esami", page: ExamsPage },
  { path: "/esami/:id", page: ExamEditPage },
  { path: "/esporta", page: ExportPage, allow: (u) => u.can_edit },
  { path: "/password", page: ChangePasswordPage },
  { path: "/admin/utenti", page: UsersPage, allow: (u) => u.is_admin },
  { path: "/admin/utenti/nuovo", page: UserFormPage, allow: (u) => u.is_admin },
  { path: "/admin/utenti/:id", page: UserFormPage, allow: (u) => u.is_admin },
  { path: "/admin/cataloghi", page: CatalogsPage, allow: (u) => u.is_admin },
  { path: "/admin/registro", page: AuditPage, allow: (u) => u.is_admin },
];
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
const KEEPALIVE_MS = 20_000;   // mentre l'utente è attivo, la sessione sul server viene rinnovata

// pagine raggiungibili senza essere collegati
const SECURE = typeof window !== "undefined" && window.isSecureContext && Boolean(window.crypto?.subtle);

function Forbidden() {
  return (
    <div className="card narrow">
      <h1>Accesso non consentito</h1>
      <p>Non hai i permessi per questa pagina.</p>
    </div>
  );
}

export function App() {
  const router = useRouter();
  const { messages, flash, dismiss } = useFlashState(router.navCount);
  const [phase, setPhase] = useState("loading");     // loading | login | unlock | ready
  const [cfg, setCfg] = useState(null);              // parametri pubblici (derivazione chiavi)
  const [user, setUser] = useState(null);
  const [keys, setKeys] = useState(null);            // chiavi in memoria (mai salvate)
  const [meta, setMeta] = useState(null);
  const [vault, setVault] = useState(null);          // archivio decifrato

  const reset = useCallback((nextPhase = "login") => {
    clearKeys();
    setUser(null);
    setKeys(null);
    setMeta(null);
    setVault(null);
    setPhase(nextPhase);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const config = await api.get("/api/public-config");
        setCfg(config);
        const me = await api.get("/api/auth/me");
        setUser(me);
        // al cambio password obbligatorio la password si chiede lì
        if (me.must_change_pw) return setPhase("ready");
        // pagina ricaricata: chiavi conservate per questa scheda e non scadute → niente password
        const cached = await loadKeys(me.id, config.session_minutes * 60_000);
        if (cached) {
          setKeys(cached);
          setPhase("ready");
        } else setPhase("unlock");
      } catch {
        reset("login");
      }
    })();
  }, [reset]);

  useEffect(() => {
    setApiHandlers({
      unauthorized: () => {
        reset("login");
        flash("Sessione scaduta: accedi di nuovo.", "info");
      },
      mustChangePassword: () => setUser((u) => (u ? { ...u, must_change_pw: true } : u)),
    });
  }, [reset, flash]);

  /** Dopo login, sblocco o cambio password. */
  const signedIn = useCallback((u, k) => {
    setUser(u);
    setKeys(k);
    setPhase("ready");
    if (k?.privateKey) saveKeys(u.id, k);
  }, []);

  const reloadVault = useCallback(async (opening = false) => {
    if (!keys?.clinical) return;
    try {
      const [m, v] = await Promise.all([api.get("/api/meta"), loadVault(keys, opening)]);
      setMeta(indexMeta(m));
      setVault(v);
    } catch (err) {
      flash(err.message, "error");
    }
  }, [keys, flash]);

  const reloadMeta = useCallback(async () => setMeta(indexMeta(await api.get("/api/meta"))), []);

  useEffect(() => {
    if (phase === "ready" && keys?.clinical && !user?.must_change_pw) reloadVault(true);
  }, [phase, keys, user?.must_change_pw, reloadVault]);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      reset("login");
      router.navigate("/", { replace: true });
      flash("Sei uscito dal sistema.", "info");
    }
  }, [router, flash, reset]);

  // Chiusura automatica dopo N minuti senza attività (mouse, tastiera, scorrimento)
  const lastActivityRef = useRef(Date.now());
  const lastPingRef = useRef(Date.now());
  useEffect(() => {
    if (phase !== "ready" || !cfg) return undefined;
    const limit = cfg.session_minutes * 60_000;
    lastActivityRef.current = Date.now();
    let lastTouch = 0;
    const onActivity = () => {
      const now = Date.now();
      lastActivityRef.current = now;
      if (now - lastTouch > 5_000) {        // aggiorna lo storage al massimo ogni 5 secondi
        lastTouch = now;
        touchActivity();
      }
    };
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    const timer = setInterval(async () => {
      const now = Date.now();
      if (now - lastActivityRef.current >= limit) {
        try {
          await api.post("/api/auth/logout");
        } catch { /* sessione già chiusa */ }
        reset("login");
        router.navigate("/", { replace: true });
        flash(`Sessione chiusa dopo ${cfg.session_minutes} minuti di inattività.`, "info");
      } else if (now - lastPingRef.current >= KEEPALIVE_MS && lastActivityRef.current > lastPingRef.current) {
        lastPingRef.current = now;
        api.get("/api/auth/me").catch(() => {});   // rinnova la sessione sul server
      }
    }, 5_000);
    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      clearInterval(timer);
    };
  }, [phase, cfg, reset, router, flash]);

  const ctx = useMemo(
    () => ({ cfg, user, keys, meta, vault, setUser, signedIn, reloadVault, reloadMeta, logout, flash }),
    [cfg, user, keys, meta, vault, signedIn, reloadVault, reloadMeta, logout, flash]
  );

  let content;
  if (!SECURE) content = <InsecureContextPage />;
  else if (phase === "loading" || !cfg) content = <Loading />;
  else if (phase === "login") content = <LoginPage />;
  else if (phase === "unlock") content = <UnlockPage />;
  else if (user.must_change_pw) content = <ChangePasswordPage />;
  else if (!keys?.clinical) content = <PendingAccessPage />;
  else if (!meta || !vault) content = <Loading text="Decifratura dell'archivio…" />;
  else {
    const match = matchRoute(ROUTES, router.pathname);
    if (!match) content = <NotFoundPage />;
    else if (match.route.allow && !match.route.allow(user)) content = <Forbidden />;
    else {
      const Page = match.route.page;
      content = <Page key={router.pathname} params={match.params} />;
    }
  }

  return (
    <AppProvider value={ctx}>
      <Layout messages={messages} onDismiss={dismiss} showNav={phase === "ready" && !!keys?.clinical}>
        {content}
      </Layout>
    </AppProvider>
  );
}
