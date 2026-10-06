import express, { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { metadata, oauthService } from "./oauth.service.js";
import { asyncHandler, validate } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { resolveWorkspace } from "../../middleware/workspace.js";

/**
 * Discovery documents, mounted at the site root (/.well-known/...). Public by
 * design: a connector reads them before it has any credentials.
 */
export const wellKnownRoutes = Router();

wellKnownRoutes.get(/^\/oauth-protected-resource(\/.*)?$/, (req, res) => res.json(metadata.protectedResource()));
wellKnownRoutes.get(/^\/(oauth-authorization-server|openid-configuration)(\/.*)?$/, (req, res) =>
  res.json(metadata.authorizationServer()),
);

const limiter = (limit) =>
  rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: { error: "temporarily_unavailable", error_description: "Too many requests" },
  });

/** Protocol endpoints answer in RFC 6749's error shape, not the app's. */
const protocol = (fn) => async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json(await fn(req));
  } catch (err) {
    if (!err.oauth) throw err;
    if (err.statusCode === 401) res.setHeader("WWW-Authenticate", 'Basic realm="oauth"');
    res.status(err.statusCode).json(err.oauth);
  }
};

const router = Router();

// Called by connectors, not the web app. Token requests are form-encoded.
router.post("/register", limiter(20), protocol((req) => oauthService.registerClient(req.body)));
router.post("/token", limiter(60), express.urlencoded({ extended: false }), protocol((req) => oauthService.token(req.body)));
router.post(
  "/revoke",
  limiter(60),
  express.urlencoded({ extended: false }),
  protocol(async (req) => {
    await oauthService.revoke(req.body);
    return {};
  }),
);

// Called by the web app's consent page, as the signed-in user.
const authParams = z.object({
  client_id: z.string().min(1).max(200),
  redirect_uri: z.string().min(1).max(2000),
  response_type: z.string().max(20),
  code_challenge: z.string().min(1).max(200).optional(),
  code_challenge_method: z.string().max(20).optional(),
  state: z.string().max(2000).optional(),
  resource: z.string().max(2000).optional(),
});

router.get(
  "/authorize",
  requireAuth,
  validate({ query: authParams }),
  asyncHandler(async (req, res) => {
    const { client, redirectHost } = await oauthService.describeRequest(req.query);
    res.json({ clientName: client.name, redirectHost });
  }),
);

router.post(
  "/authorize",
  requireAuth,
  resolveWorkspace,
  validate({ body: authParams.extend({ allow: z.boolean() }) }),
  asyncHandler(async (req, res) => {
    const { allow, ...params } = req.body;
    const redirectTo = await oauthService.authorize({
      userId: req.auth.userId,
      workspaceId: req.workspace._id,
      params,
      allow,
    });
    res.json({ redirectTo });
  }),
);

router.get(
  "/connections",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ connections: await oauthService.connections(req.auth.userId) });
  }),
);

router.delete(
  "/connections/:id",
  requireAuth,
  validate({ params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) }) }),
  asyncHandler(async (req, res) => {
    res.json(await oauthService.disconnect(req.auth.userId, req.params.id));
  }),
);

export default router;
