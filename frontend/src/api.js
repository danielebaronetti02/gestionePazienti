// Client per le API del backend FastAPI.
// - il cookie di sessione viaggia da solo (HttpOnly, stesso dominio)
// - ogni richiesta porta l'intestazione anti-CSRF richiesta dal backend
// - gli errori diventano ApiError con il messaggio in italiano inviato dal server

const CSRF_HEADER = { "X-Requested-With": "GestionePazienti" };

export class ApiError extends Error {
  constructor(status, detail, code) {
    super(detail);
    this.status = status;
    this.code = code;
  }
}

let handlers = { unauthorized: () => {}, mustChangePassword: () => {} };

/** App.jsx registra cosa fare se la sessione scade o serve il cambio password. */
export function setApiHandlers(h) {
  handlers = { ...handlers, ...h };
}

function withParams(url, params) {
  if (!params) return url;
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== false) q.set(k, v);
  });
  const s = q.toString();
  return s ? `${url}?${s}` : url;
}

async function request(method, url, body, { raw = false } = {}) {
  const opts = { method, credentials: "same-origin", headers: { ...CSRF_HEADER } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError(0, "Server non raggiungibile. Controlla la connessione e riprova.");
  }
  if (!res.ok) {
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* risposta non JSON */
    }
    const err = new ApiError(res.status, data.detail || `Errore ${res.status}`, data.code);
    // 401 su login/verifica iniziale è normale (non collegati): niente avviso di sessione scaduta
    if (res.status === 401 && !url.startsWith("/api/auth/login") && !url.startsWith("/api/auth/me")) handlers.unauthorized();
    if (res.status === 403 && data.code === "must_change_password") handlers.mustChangePassword();
    throw err;
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (url, params) => request("GET", withParams(url, params)),
  post: (url, body = {}) => request("POST", url, body),
  put: (url, body = {}) => request("PUT", url, body),
  patch: (url, body = {}) => request("PATCH", url, body),
  del: (url) => request("DELETE", url),
};
