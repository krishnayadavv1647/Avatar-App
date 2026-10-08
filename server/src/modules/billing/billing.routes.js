import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { CreditPack, User } from "../../models/index.js";
import { creditService } from "./credit.service.js";
import { canSell, createCheckoutSession } from "../../integrations/payments/stripe.js";
import { asyncHandler, validate } from "../../middleware/validate.js";
import { loadActor, requireManager } from "../../middleware/teamRole.js";
import { resolveWorkspace } from "../../middleware/workspace.js";
import { env } from "../../config/env.js";

/** Mounted at /api/billing (signed in): the person's credits. */
const router = Router();
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
router.use(resolveWorkspace);

/** The pack as a person sees it. */
const present = (pack) => ({
  _id: pack._id,
  name: pack.name,
  description: pack.description || null,
  credits: pack.credits,
  priceCents: pack.priceCents,
  currency: pack.currency,
  badge: pack.badge || null,
});

router.get(
  "/credits",
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const [summary, packs] = await Promise.all([
      creditService.summary(req.workspace),
      CreditPack.find({ active: true }).sort({ displayOrder: 1, priceCents: 1 }).lean(),
    ]);
    res.json({
      ...summary,
      packs: packs.map(present),
      // Packs can only be bought once there is somewhere to take the payment.
      purchasable: canSell(),
    });
  }),
);

router.get(
  "/credit-transactions",
  validate({ query: z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) }) }),
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await creditService.listTransactions(req.workspace._id, { page: req.query.page }));
  }),
);

// Every checkout is a call to Stripe, so starting one is limited per person.
const checkoutLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `checkout:${req.auth?.userId}`,
  validate: { keyGeneratorIpFallback: false },
  message: { error: { message: "That is a lot of purchases started. Wait a few minutes and try again." } },
});

/** Starts buying a pack: answers with the Stripe page to send the person to. */
router.post(
  "/checkout",
  // Spending the workspace's money is for its owner and admins, not every member.
  loadActor,
  requireManager,
  checkoutLimit,
  validate({ body: z.object({ packId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid pack") }) }),
  asyncHandler(async (req, res) => {
    if (!canSell()) throw fail(503, "Buying credits is not set up yet.");

    const pack = await CreditPack.findById(req.body.packId).lean();
    if (!pack) throw fail(404, "That pack was not found.");
    if (!pack.active) throw fail(422, "That pack is no longer for sale.");

    const user = await User.findById(req.auth.userId).select("email").lean();
    // The credits go to the workspace the person is signed in to.
    const session = await createCheckoutSession({
      pack,
      workspaceId: req.workspace._id,
      userId: req.auth.userId,
      email: user?.email,
      // Stripe fills in {CHECKOUT_SESSION_ID} itself; it must stay literal.
      successUrl: `${env.clientOrigin}/credits?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${env.clientOrigin}/credits?purchase=cancelled`,
    });
    res.json({ url: session.url });
  }),
);

export default router;
