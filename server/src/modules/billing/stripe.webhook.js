import express, { Router } from "express";
import { Workspace } from "../../models/index.js";
import { creditService } from "./credit.service.js";
import { verifyWebhook } from "../../integrations/payments/stripe.js";
import { asyncHandler } from "../../middleware/validate.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { logError } from "../../utils/errorLog.js";

/**
 * POST /api/webhooks/stripe - Stripe telling us a payment happened.
 *
 * Mounted from app.js BEFORE express.json(), because the signature is over the
 * exact bytes Stripe sent and a parsed-and-reserialised body would not match.
 *
 * Only a correctly signed event is believed; without a configured secret the
 * endpoint refuses everything rather than accept unsigned events. An answer of
 * 200 means "got it, stop retrying", so it is given for anything we do not act
 * on; a real failure on our side (the database) is a 500 so Stripe retries.
 */
const router = Router();

const PAID_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
const REFUND_EVENTS = new Set(["charge.refunded", "charge.dispute.created"]);

const ignored = (reason) => ({ received: true, handled: false, reason });

/** Credits a paid Checkout Session, once however many times Stripe delivers it. */
async function creditPurchase(session) {
  if (session.payment_status !== "paid") return ignored("not paid");

  const meta = session.metadata || {};
  const credits = Number(meta.credits);
  if (!Number.isInteger(credits) || credits <= 0) return ignored("no credits in metadata");

  // The session was created for this workspace; the two must agree, or the
  // metadata is not ours to trust.
  const workspaceId = meta.workspaceId;
  if (!/^[0-9a-f]{24}$/i.test(workspaceId || "") || session.client_reference_id !== workspaceId) {
    return ignored("workspace mismatch");
  }
  if (!(await Workspace.exists({ _id: workspaceId }))) return ignored("unknown workspace");

  const result = await creditService.applyTransaction({
    workspaceId,
    kind: "purchase",
    credits,
    // The session id makes a second delivery (or both event types) a no-op.
    ref: `stripe:${session.id}`,
    note: `Credit pack: ${meta.packName}`,
    meta: {
      sessionId: session.id,
      paymentIntent: session.payment_intent,
      amountTotal: session.amount_total,
      currency: session.currency,
      packId: meta.packId,
    },
  });
  return { received: true, handled: true, credited: result.applied };
}

/**
 * A refund or dispute is not deducted automatically: the credits may already be
 * spent and whether to claw them back is a judgement call. It is recorded for an
 * admin, who can remove credits by hand from the user's page.
 */
async function flagRefund(event) {
  const object = event.data?.object || {};
  const isCharge = object.object === "charge";
  await logError({
    errorType: "PAYMENT_REFUND",
    severity: "WARNING",
    message: `Stripe reported ${event.type}. Credits were not removed; check the user's page and adjust by hand if needed.`,
    functionName: "stripe.webhook",
    details: {
      eventId: event.id,
      type: event.type,
      chargeId: isCharge ? object.id : object.charge,
      paymentIntent: object.payment_intent,
      amount: object.amount,
      currency: object.currency,
    },
  });
  return { received: true, handled: false, reason: "flagged for an admin" };
}

router.post(
  "/",
  express.raw({ type: "application/json", limit: "1mb" }),
  asyncHandler(async (req, res) => {
    const secret = env.stripe.webhookSecret;
    if (!secret) {
      return res.status(503).json({ error: { message: "Stripe webhooks are not set up on this server." } });
    }

    let event;
    try {
      event = verifyWebhook(req.body, req.get("stripe-signature"), secret);
    } catch (err) {
      logger.warn({ reason: err.message }, "stripe webhook rejected");
      return res.status(400).json({ error: { message: err.message } });
    }

    if (PAID_EVENTS.has(event.type)) return res.json(await creditPurchase(event.data?.object || {}));
    if (REFUND_EVENTS.has(event.type)) return res.json(await flagRefund(event));
    return res.json(ignored("event not used"));
  }),
);

export default router;
