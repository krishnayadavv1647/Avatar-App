import { Router } from "express";
import { z } from "zod";
import { CreditPack, CreditTransaction, User, Workspace } from "../../../models/index.js";
import { DEFAULT_RATES, RENDER_MODELS, creditService } from "../../billing/credit.service.js";
import { audit, fail } from "../admin.shared.js";
import { asyncHandler, validate } from "../../../middleware/validate.js";

/**
 * Admin API for credits: the rates and welcome credits, the packs for sale, one
 * user's balance and what an admin can do to it, and the platform's ledger.
 * Mounted under /api/admin (platform admins only).
 */
const router = Router();

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");
const idParam = validate({ params: z.object({ id: objectId }) });

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- rates and welcome credits ---------------------------------------------------

const rate = z.coerce.number().positive().max(10_000);

router.get(
  "/credits/settings",
  asyncHandler(async (req, res) => {
    res.json({
      rates: await creditService.getRates(),
      defaults: DEFAULT_RATES,
      welcomeCredits: await creditService.getWelcomeCredits(),
      models: RENDER_MODELS,
    });
  }),
);

router.put(
  "/credits/settings",
  validate({
    body: z
      .object({
        rates: z.object({ standard: rate, flash: rate, lite: rate }),
        welcomeCredits: z.coerce.number().int().min(0).max(1_000_000),
      })
      .partial()
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const saved = await creditService.saveSettings(req.body, req.admin._id);
    res.json({ ...saved, defaults: DEFAULT_RATES, models: RENDER_MODELS });
  }),
);

// ---- packs ----------------------------------------------------------------------

const packFields = {
  name: z.string().trim().min(1, "Name is required").max(60),
  description: z.string().trim().max(200).optional(),
  credits: z.coerce.number().int().min(1).max(10_000_000),
  priceCents: z.coerce.number().int().min(50, "Stripe cannot charge under $0.50").max(100_000_00),
  badge: z.string().trim().max(24).optional(),
  displayOrder: z.coerce.number().int().min(0).max(10_000),
  active: z.boolean(),
};

router.get(
  "/credit-packs",
  asyncHandler(async (req, res) => {
    res.json({ packs: await CreditPack.find().sort({ displayOrder: 1, priceCents: 1 }).lean() });
  }),
);

router.post(
  "/credit-packs",
  validate({ body: z.object(packFields).partial({ description: true, badge: true, displayOrder: true, active: true }).strict() }),
  asyncHandler(async (req, res) => {
    const pack = await CreditPack.create({ ...req.body, createdBy: req.admin._id });
    res.status(201).json({ pack });
  }),
);

router.patch(
  "/credit-packs/:id",
  validate({ params: z.object({ id: objectId }), body: z.object(packFields).partial().strict() }),
  asyncHandler(async (req, res) => {
    const pack = await CreditPack.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    if (!pack) throw fail(404, "Pack not found");
    res.json({ pack });
  }),
);

router.delete(
  "/credit-packs/:id",
  idParam,
  asyncHandler(async (req, res) => {
    const pack = await CreditPack.findByIdAndDelete(req.params.id);
    if (!pack) throw fail(404, "Pack not found");
    // Purchases already made keep their ledger entries; only the offer goes.
    res.json({ id: req.params.id });
  }),
);

// ---- one user ---------------------------------------------------------------------

async function userWorkspace(id) {
  const user = await User.findById(id).select("email name workspaceId").lean();
  if (!user) throw fail(404, "User not found");
  if (!user.workspaceId) throw fail(422, "That user has no workspace.");
  return user;
}

router.get(
  "/users/:id/credits",
  idParam,
  asyncHandler(async (req, res) => {
    const user = await userWorkspace(req.params.id);
    const workspace = { _id: user.workspaceId };
    // In order: summary() is what brings the account up to date (a plan just
    // changed), so reading the history alongside it could miss the new grant.
    const summary = await creditService.summary(workspace);
    const history = await creditService.listTransactions(user.workspaceId, { limit: 25 });
    res.json({ ...summary, ...history });
  }),
);

router.post(
  "/users/:id/credits",
  validate({
    params: z.object({ id: objectId }),
    body: z.object({
      credits: z.coerce
        .number()
        .int()
        .refine((n) => n !== 0, "Enter a number of credits, positive to add or negative to remove")
        .refine((n) => Math.abs(n) <= 10_000_000, "That is too many credits"),
      note: z.string().trim().min(3, "Say why, in a few words").max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    const user = await userWorkspace(req.params.id);
    const balance = await creditService.adjustCredits({
      workspaceId: user.workspaceId,
      credits: req.body.credits,
      note: req.body.note,
      actorId: req.admin._id,
    });
    await audit({
      workspaceId: user.workspaceId,
      admin: req.admin,
      action: req.body.credits > 0 ? "credits.grant" : "credits.deduct",
      target: { kind: "user", id: String(user._id) },
      meta: { credits: req.body.credits, note: req.body.note },
      ip: req.ip,
    });
    res.json({ balance });
  }),
);

// ---- the platform's ledger -----------------------------------------------------------

router.get(
  "/credit-transactions",
  validate({
    query: z.object({
      kind: z.enum(["plan_grant", "signup_grant", "admin_grant", "admin_deduct", "purchase", "usage", "refund"]).optional(),
      q: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).max(10_000).default(1),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { kind, q, page } = req.query;
    const limit = 25;
    const filter = {};
    if (kind) filter.kind = kind;

    if (q) {
      // By the owner's name or email.
      const rx = new RegExp(escapeRegex(q), "i");
      const owners = await User.find({ $or: [{ email: rx }, { name: rx }] }).select("workspaceId").limit(500).lean();
      filter.workspaceId = { $in: owners.map((u) => u.workspaceId).filter(Boolean) };
    }

    const [rows, total] = await Promise.all([
      CreditTransaction.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CreditTransaction.countDocuments(filter),
    ]);

    const workspaces = await Workspace.find({ _id: { $in: rows.map((r) => r.workspaceId) } }).select("ownerId").lean();
    const owners = await User.find({ _id: { $in: workspaces.map((w) => w.ownerId).filter(Boolean) } })
      .select("name email")
      .lean();
    const ownerOf = new Map(
      workspaces.map((w) => [String(w._id), owners.find((u) => String(u._id) === String(w.ownerId)) || null]),
    );

    res.json({
      transactions: rows.map((r) => ({
        _id: r._id,
        kind: r.kind,
        credits: r.credits,
        balanceAfter: r.balanceAfter,
        note: r.note,
        createdAt: r.createdAt,
        user: ownerOf.get(String(r.workspaceId)) && {
          _id: ownerOf.get(String(r.workspaceId))._id,
          name: ownerOf.get(String(r.workspaceId)).name,
          email: ownerOf.get(String(r.workspaceId)).email,
        },
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  }),
);

export default router;
