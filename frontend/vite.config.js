import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In sviluppo (npm run dev) le chiamate /api vanno al backend FastAPI su :8000
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: { outDir: "dist", sourcemap: false },
});
