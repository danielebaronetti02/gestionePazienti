import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In sviluppo (npm run dev) le chiamate /api vanno al backend FastAPI su :8000
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  // es2022: richiesto da pdf.js (lettura dei PDF). Browser supportati: Chrome/Edge 94+, Firefox 93+, Safari 15.4+
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
