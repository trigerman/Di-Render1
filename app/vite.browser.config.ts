import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// DI_RENDER_BASE lets the same build run at "/" (local) or "/<repo>/" (GitHub Pages project site).
const base = process.env.DI_RENDER_BASE ?? "/";

export default defineConfig({
  base: base.endsWith("/") ? base : `${base}/`,
  publicDir: "public-browser",
  plugins: [react()],
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0 },
  server: { host: "127.0.0.1", strictPort: true },
});
