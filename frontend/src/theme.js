// Modalità giorno / notte. La scelta resta salvata in questo browser (non è un dato sanitario).
//   "chiaro" · "scuro" · "auto" (segue l'impostazione del sistema operativo)
const KEY = "gp_tema";
const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function getThemeChoice() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "chiaro" || v === "scuro" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function resolvedTheme(choice = getThemeChoice()) {
  if (choice === "auto") return media?.matches ? "scuro" : "chiaro";
  return choice;
}

export function applyTheme(choice = getThemeChoice()) {
  document.documentElement.dataset.theme = resolvedTheme(choice) === "scuro" ? "dark" : "light";
}

export function setThemeChoice(choice) {
  try {
    if (choice === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* archiviazione non disponibile: vale solo per questa pagina */
  }
  applyTheme(choice);
}

/** Da chiamare una volta all'avvio: applica il tema e segue i cambi del sistema in modalità automatica. */
export function initTheme() {
  applyTheme();
  media?.addEventListener?.("change", () => { if (getThemeChoice() === "auto") applyTheme("auto"); });
}
