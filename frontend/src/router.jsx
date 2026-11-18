// Router minimale basato sulla History API (nessuna dipendenza esterna).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const RouterContext = createContext(null);

function currentLocation() {
  return { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash };
}

export function RouterProvider({ children }) {
  const [loc, setLoc] = useState(currentLocation);
  const [navCount, setNavCount] = useState(0);

  useEffect(() => {
    const onPop = () => {
      setLoc(currentLocation());
      setNavCount((n) => n + 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    window.history[replace ? "replaceState" : "pushState"](null, "", to);
    setLoc(currentLocation());
    setNavCount((n) => n + 1);
    if (!to.includes("#")) window.scrollTo(0, 0);
  }, []);

  const value = useMemo(() => ({ ...loc, navCount, navigate }), [loc, navCount, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

/** { pathname, search, hash, query (URLSearchParams), navCount, navigate } */
export function useRouter() {
  const ctx = useContext(RouterContext);
  return useMemo(() => ({ ...ctx, query: new URLSearchParams(ctx.search) }), [ctx]);
}

export function Link({ to, children, ...rest }) {
  const { navigate } = useRouter();
  const onClick = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}

/** Trova la prima rotta che corrisponde, es. "/pazienti/:code" → { params: { code } }. */
export function matchRoute(routes, pathname) {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  for (const route of routes) {
    const pattern = route.path.split("/").filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params = {};
    const ok = pattern.every((seg, i) => {
      if (seg.startsWith(":")) {
        params[seg.slice(1)] = decodeURIComponent(parts[i]);
        return true;
      }
      return seg === parts[i];
    });
    if (ok) return { route, params };
  }
  return null;
}
