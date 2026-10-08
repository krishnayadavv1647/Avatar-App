import express from "express";
import fs from "node:fs";
import path from "node:path";
import helmet from "helmet";
import cors from "cors";
import { env, isProd } from "./config/env.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { livekitConfig } from "./integrations/livekit/index.js";
import { implementedProviderIds } from "./avatar/providers/registry.js";
import avatarRoutes from "./modules/avatars/avatar.routes.js";
import roomRoutes from "./modules/rooms/room.routes.js";
import studioRoutes from "./modules/studio/studio.routes.js";
import voiceRoutes from "./modules/voices/voice.routes.js";
import providerWebhooks from "./webhooks/provider.webhook.js";
import authRoutes from "./modules/auth/auth.routes.js";
import analyticsRoutes from "./modules/analytics/analytics.routes.js";
import conversationRoutes from "./modules/conversations/conversation.routes.js";
import linkRoutes from "./modules/links/link.routes.js";
import apiKeyRoutes from "./modules/apiKeys/apiKey.routes.js";
import mcpRoutes from "./modules/mcp/mcp.routes.js";
import oauthRoutes, { wellKnownRoutes } from "./modules/oauth/oauth.routes.js";
import siteConfigRoutes from "./modules/siteConfig/siteConfig.routes.js";
import siteContentRoutes from "./modules/siteContent/siteContent.routes.js";
import invitationRoutes from "./modules/invitations/invitation.routes.js";
import inboundMailRoutes from "./modules/comms/webhook.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import { authenticate, requireAuth } from "./middleware/auth.js";
import billingRoutes from "./modules/billing/billing.routes.js";
import teamRoutes from "./modules/team/team.routes.js";
import joinRoutes from "./modules/team/join.routes.js";
import profileRoutes from "./modules/profile/profile.routes.js";
import stripeWebhook from "./modules/billing/stripe.webhook.js";
import { impersonationGuard } from "./middleware/impersonation.js";
import impersonationRoutes from "./modules/impersonation/impersonation.routes.js";
import { getStorage } from "./integrations/storage/registry.js";

/**
 * Where the built web app is, if this API should serve it. One service then
 * carries the whole product - the pages, the API and (with start-all.js) the
 * agent worker. Off in development, where Vite serves the app, unless forced.
 */
function webAppDir() {
  if (env.serveClient === "false") return null;
  if (!isProd && env.serveClient !== "true") return null;
  const dir = path.resolve(import.meta.dirname, "../../client/dist");
  return fs.existsSync(path.join(dir, "index.html")) ? dir : null;
}

export function createApp() {
  const app = express();

  const webApp = webAppDir();

  // crossOriginResourcePolicy off: uploaded images are served from this origin
  // and rendered by the client on another one during development.
  const apiHeaders = helmet({ crossOriginResourcePolicy: false });

  // The web app's pages need looser headers than the API: they load photos and
  // clips from other hosts (Unsplash, R2) and open a LiveKit connection, which
  // helmet's default content policy forbids, and /embed is meant to be framed
  // by other sites. Everything else helmet sets is kept.
  const pageHeaders = helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false,
    frameguard: false,
    // Google's sign-in popup reports back to this page; plain "same-origin"
    // severs that link and the popup closes without signing anyone in.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  });
  app.use((req, res, next) => {
    if (!webApp || req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) {
      return apiHeaders(req, res, next);
    }
    // Only the embed may be framed elsewhere; the app itself may not.
    if (!req.path.startsWith("/embed/")) res.setHeader("X-Frame-Options", "SAMEORIGIN");
    return pageHeaders(req, res, next);
  });
  // Connectors are other sites and call these without our cookies or origin.
  const openCors = cors();
  const appCors = cors({ origin: env.clientOrigin, credentials: true });
  const isOpen = (p) => p.startsWith("/.well-known/") || ["/api/oauth/register", "/api/oauth/token", "/api/oauth/revoke", "/api/mcp"].includes(p);
  app.use((req, res, next) => (isOpen(req.path) ? openCors : appCors)(req, res, next));
  // Stripe signs the exact bytes it sends, so this one webhook reads its body
  // raw and must be mounted before express.json() below consumes it.
  app.use("/api/webhooks/stripe", stripeWebhook);
  app.use(express.json({ limit: "1mb" }));

  // Runs on every request but rejects nothing; routes opt into requireAuth.
  app.use(authenticate);
  // An admin acting as a user: refused actions and the audit trail.
  app.use(impersonationGuard);

  const storage = getStorage();

  /**
   * Reports what this instance can actually do, so the client can show the
   * real state instead of guessing - which provider is active, whether LiveKit
   * is the local dev server or Cloud.
   */
  app.get("/api/health", (req, res) => {
    const lk = livekitConfig();
    res.json({
      ok: true,
      env: env.nodeEnv,
      avatarProvider: env.avatarProvider,
      implementedProviders: implementedProviderIds(),
      livekit: { url: lk.url, mode: lk.isDev ? "self-hosted-dev" : "configured" },
      storage: { driver: storage.id, reachableByVendors: storage.reachableByVendors },
    });
  });

  // Only the local driver keeps files on this box; with r2 nothing is served here.
  if (storage.id === "local") {
    app.use("/uploads", express.static(path.resolve("uploads"), { maxAge: "1h" }));
  }

  app.use("/api/auth", authRoutes);

  // Everything below is workspace-scoped and needs a signed-in caller.
  app.use("/api/avatars", requireAuth, avatarRoutes);
  app.use("/api/rooms", requireAuth, roomRoutes);
  app.use("/api/studio", requireAuth, studioRoutes);
  app.use("/api/voices", requireAuth, voiceRoutes);
  app.use("/api/analytics", requireAuth, analyticsRoutes);
  app.use("/api/conversations", requireAuth, conversationRoutes);
  app.use("/.well-known", wellKnownRoutes);
  // Public: the app's name and branding, and the invitation link a person opens before they have an account.
  app.use("/api/config", siteConfigRoutes);
  app.use("/api/invitations", invitationRoutes);
  // Signed in: notifications, banners and cards an admin published.
  app.use("/api/site", requireAuth, siteContentRoutes);
  // Called by the mail provider, not a user.
  app.use("/api/inbound", inboundMailRoutes);
  app.use("/api/oauth", oauthRoutes);
  // The signed-in person's credits.
  app.use("/api/billing", requireAuth, billingRoutes);
  // The people in the workspace, and the signed-in person's own profile.
  app.use("/api/team", requireAuth, teamRoutes);
  // Public: the page behind a workspace invite link, before the person has an account.
  app.use("/api/join", joinRoutes);
  app.use("/api/profile", requireAuth, profileRoutes);
  app.use("/api/impersonation", requireAuth, impersonationRoutes);
  app.use("/api/api-keys", requireAuth, apiKeyRoutes);
  // The app as an MCP server. It authenticates with its own API key, not a session.
  app.use("/api/mcp", mcpRoutes);
  // Platform admin. Signed in to reach it; ADMIN_EMAILS to get past /access.
  app.use("/api/admin", requireAuth, adminRoutes);

  // Share links are used by people without an account. The token in the URL is
  // the credential; see modules/links for what it does and does not allow.
  app.use("/api/links", linkRoutes);

  // Webhooks are called by vendors, not users - they authenticate by the
  // signed callback URL instead of a bearer token.
  app.use("/api/webhooks", providerWebhooks);

  // The web app, when this API also serves it: its built files, and index.html
  // for every other page address so the client-side router can take over
  // (/avatars, /talk/:token, a refresh on any page). API paths are excluded, so
  // an unknown /api route still answers with JSON rather than a web page.
  if (webApp) {
    app.use(express.static(webApp, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/|uploads\/).*/, (req, res, next) => {
      // A missing file (an old bundle, a typo) is a 404, not the home page.
      if (path.extname(req.path)) return next();
      // index.html names the hashed bundles, so it must never be cached.
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(webApp, "index.html"));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
