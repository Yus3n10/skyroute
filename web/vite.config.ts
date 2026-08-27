import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // In development the API runs as a separate process on :8000. In production
  // FastAPI serves this build directly, so there is no cross-origin request at all.
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
