// Hook riutilizzati dalle pagine.
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Carica dati da un endpoint GET e li ricarica quando cambiano url/parametri. */
export function useApi(url, params) {
  const key = url ? url + JSON.stringify(params || {}) : null;
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(url) });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .get(url, params)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

/** Stato di un modulo: [valori, cambia(campo)(evento|valore), impostaTutti]. */
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const bind = useCallback(
    (field) => (e) => {
      const v = e && e.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e;
      setValues((old) => ({ ...old, [field]: v }));
    },
    []
  );
  return [values, bind, setValues];
}

/** Esegue un'azione asincrona tenendo traccia di "in corso" (per disabilitare i pulsanti). */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, run];
}
