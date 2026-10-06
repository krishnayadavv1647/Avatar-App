import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      // Keeps the browser on one origin in dev, so cookies and CORS behave
      // the same way they will in production behind a single domain.
      "/api": {
        target: process.env.VITE_SERVER_ORIGIN || "http://localhost:4000",
        changeOrigin: true,
      },
      // OAuth discovery for MCP connectors lives at the site root.
      "/.well-known": {
        target: process.env.VITE_SERVER_ORIGIN || "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
