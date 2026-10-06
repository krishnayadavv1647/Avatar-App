import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Link-preview tags need absolute addresses. Set VITE_PUBLIC_URL on the host that
// builds the site (the address people actually share); this is the fallback.
const SITE_URL = (process.env.VITE_PUBLIC_URL || "https://avatar.flydesignsstudio.com").replace(/\/+$/, "");
const siteUrl = () => ({
  name: "site-url",
  transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", SITE_URL),
});

export default defineConfig({
  plugins: [react(), siteUrl()],
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
