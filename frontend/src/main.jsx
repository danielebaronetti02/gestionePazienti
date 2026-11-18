import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RouterProvider } from "./router";
import "./styles.css";
import { initTheme } from "./theme";

initTheme();   // prima del primo disegno, per non far lampeggiare il tema chiaro

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <RouterProvider>
      <App />
    </RouterProvider>
  </StrictMode>
);
