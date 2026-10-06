import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { invitationService } from "./invitation.service.js";
import { asyncHandler, validate } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";

/**
 * Opening and accepting an invitation link. Mounted at /api/invitations.
 *
 * Describing a link is public (the token is the credential, and the page has
 * to render before anyone signs in); accepting needs a signed-in account.
 */
const router = Router();

// The token is long and random, but anything that answers "valid or not" to
// strangers is worth slowing down.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: { message: "Too many attempts. Try again later." } },
});

const byToken = { params: z.object({ token: z.string().min(20).max(200) }) };

router.get(
  "/:token",
  limiter,
  validate(byToken),
  asyncHandler(async (req, res) => {
    res.json(await invitationService.describe(req.params.token));
  }),
);

router.post(
  "/:token/accept",
  limiter,
  requireAuth,
  validate(byToken),
  asyncHandler(async (req, res) => {
    res.json(await invitationService.accept(req.params.token, { userId: req.auth.userId }));
  }),
);

export default router;
