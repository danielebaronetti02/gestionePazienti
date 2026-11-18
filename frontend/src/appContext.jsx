// Stato globale: utente collegato, dati di riferimento (/api/meta), messaggi a comparsa.
import { createContext, useCallback, useContext, useRef, useState } from "react";

const AppContext = createContext(null);

export function AppProvider({ value, children }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** { user, meta, setUser, reloadMeta, logout, flash } */
export function useApp() {
  return useContext(AppContext);
}

/**
 * Messaggi "flash" come nelle app server: restano visibili sulla pagina in cui
 * vengono creati e su quella successiva (es. "Paziente creato" dopo il reindirizzamento).
 */
export function useFlashState(navCount) {
  const [messages, setMessages] = useState([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id) => setMessages((m) => m.filter((x) => x.id !== id)), []);
  const flash = useCallback(
    (text, type = "success") => {
      const id = nextId.current++;
      setMessages((m) => [...m.filter((x) => x.text !== text), { id, text, type, nav: navCount }]);
      // le conferme spariscono da sole; gli errori restano finché si cambia pagina e si portano in vista
      if (type !== "error") setTimeout(() => dismiss(id), 8000);
      else window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [navCount, dismiss]
  );
  const visible = messages.filter((m) => m.nav >= navCount - 1);
  return { messages: visible, flash, dismiss };
}
