import { authService } from "./auth.service.js";
import { googleEnabled } from "./google.js";
import { asyncHandler } from "../../middleware/validate.js";
import { env } from "../../config/env.js";

export const authController = {
  register: asyncHandler(async (req, res) => {
    res.status(201).json(await authService.register(req.body));
  }),

  login: asyncHandler(async (req, res) => {
    res.json(await authService.login(req.body));
  }),

  google: asyncHandler(async (req, res) => {
    res.json(await authService.google(req.body));
  }),

  /** What the sign-in page needs before anyone is signed in. */
  config: (req, res) => {
    res.json({ googleClientId: googleEnabled() ? env.google.clientId : null });
  },

  refresh: asyncHandler(async (req, res) => {
    res.json(await authService.refresh(req.body.refreshToken));
  }),

  /** Signs out everywhere, not just this device - refresh tokens are versioned. */
  logout: asyncHandler(async (req, res) => {
    await authService.revokeAll(req.auth.userId);
    res.json({ ok: true });
  }),

  me: asyncHandler(async (req, res) => {
    res.json({ auth: req.auth, workspace: req.workspace });
  }),
};
