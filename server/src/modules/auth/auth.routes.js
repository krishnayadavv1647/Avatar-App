import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { authController } from "./auth.controller.js";
import { authValidation } from "./auth.validation.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { resolveWorkspace } from "../../middleware/workspace.js";

/**
 * Credential endpoints are the obvious target for guessing, so they get a much
 * tighter limit than the rest of the API. Keyed on IP + email so one attacker
 * cannot lock out an unrelated account by spraying its address.
 */
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // ipKeyGenerator normalises IPv6 to its /64 prefix. Using req.ip raw would
  // let anyone with an IPv6 allocation rotate addresses to bypass the limit.
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.email || "").toLowerCase()}`,
  message: { error: { message: "Too many attempts. Try again later." } },
});

const router = Router();

router.post("/register", credentialLimiter, validate(authValidation.register), authController.register);
router.post("/login", credentialLimiter, validate(authValidation.login), authController.login);
router.post("/google", credentialLimiter, validate(authValidation.google), authController.google);
router.get("/config", authController.config);
router.post("/refresh", validate(authValidation.refresh), authController.refresh);
router.post("/logout", requireAuth, authController.logout);
router.get("/me", requireAuth, resolveWorkspace, authController.me);

export default router;
