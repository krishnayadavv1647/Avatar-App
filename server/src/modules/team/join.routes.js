import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z } from "zod";
import { inviteService } from "./invite.service.js";
import { asyncHandler, validate } from "../../middleware/validate.js";

/**
 * Opening a workspace invite link, before the person has an account. Mounted at
 * /api/join (public): the token in the address is the credential.
 */
const router = Router();

// Anything that answers "valid or not" to strangers is worth slowing down.
const describeLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: { message: "Too many attempts. Try again later." } },
});

// Making an account is the credential endpoint: as tight as sign-up.
const joinLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.email || "").toLowerCase()}`,
  message: { error: { message: "Too many attempts. Try again later." } },
});

const byToken = z.object({ token: z.string().min(20).max(200) });

router.get(
  "/:token",
  describeLimit,
  validate({ params: byToken }),
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await inviteService.describe(req.params.token));
  }),
);

router.post(
  "/:token",
  joinLimit,
  validate({
    params: byToken,
    body: z.object({
      name: z.string().trim().min(1, "Name is required").max(80),
      email: z.string().trim().email("Enter a valid email").max(200),
      password: z.string().min(10, "Use at least 10 characters").max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await inviteService.join(req.params.token, req.body));
  }),
);

export default router;
