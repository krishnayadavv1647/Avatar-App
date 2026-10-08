import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { teamService } from "./team.service.js";
import { EXPIRY_DAYS, MAX_USES, inviteService } from "./invite.service.js";
import { asyncHandler, validate } from "../../middleware/validate.js";
import { resolveWorkspace } from "../../middleware/workspace.js";
import { loadActor, requireManager } from "../../middleware/teamRole.js";

/**
 * The people in the signed-in person's workspace. Mounted at /api/team.
 * Owners and admins only; what each may do to whom is in team.service.js.
 */
const router = Router();
router.use(resolveWorkspace, loadActor, requireManager);

// Making accounts and passwords is worth slowing down for one person.
const writeLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `team:${req.auth?.userId}`,
  validate: { keyGeneratorIpFallback: false },
  message: { error: { message: "Too many changes. Wait a few minutes and try again." } },
});

const id = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");
const name = z.string().trim().min(1, "Name is required").max(80);
const password = z.string().min(10, "Use at least 10 characters").max(200);

router.get(
  "/members",
  asyncHandler(async (req, res) => {
    res.json({ members: await teamService.list(req.workspace), me: String(req.actor._id), role: req.actor.role });
  }),
);

router.post(
  "/members",
  writeLimit,
  validate({
    body: z.object({
      name,
      email: z.string().trim().email("Enter a valid email").max(200),
      password,
      role: z.enum(["admin", "member"]).default("member"),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ member: await teamService.create(req, req.body) });
  }),
);

router.patch(
  "/members/:id",
  writeLimit,
  validate({
    params: z.object({ id }),
    body: z
      .object({ name, role: z.enum(["admin", "member"]), title: z.string().trim().max(80) })
      .partial()
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    res.json({ member: await teamService.update(req, req.params.id, req.body) });
  }),
);

router.post(
  "/members/:id/password",
  writeLimit,
  validate({ params: z.object({ id }), body: z.object({ password }) }),
  asyncHandler(async (req, res) => {
    res.json(await teamService.resetPassword(req, req.params.id, req.body.password));
  }),
);

router.delete(
  "/members/:id",
  writeLimit,
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => {
    res.json(await teamService.remove(req, req.params.id));
  }),
);

// ---- invite links --------------------------------------------------------------

router.get(
  "/invites",
  asyncHandler(async (req, res) => {
    res.json({ invites: await inviteService.list(req.workspace) });
  }),
);

router.post(
  "/invites",
  writeLimit,
  validate({
    body: z.object({
      role: z.enum(["admin", "member"]).default("member"),
      expiresInDays: z.coerce.number().int().refine((n) => EXPIRY_DAYS.includes(n), `Choose ${EXPIRY_DAYS.join(", ")} days`).default(7),
      maxUses: z.coerce.number().int().min(1).max(MAX_USES).default(1),
      // Optional: a link that works for one address only.
      email: z.string().trim().email("Enter a valid email").max(200).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(await inviteService.create(req, req.body));
  }),
);

router.delete(
  "/invites/:id",
  writeLimit,
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => {
    res.json(await inviteService.revoke(req, req.params.id));
  }),
);

export default router;
