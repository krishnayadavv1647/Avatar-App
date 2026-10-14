import { Conversation, Subscription } from "../../models/index.js";
import { roomService } from "../rooms/room.service.js";
import { availableCredits, chargeConversation, ensureGrants, isUnlimited } from "./credit.service.js";
import { logger } from "../../config/logger.js";

/**
 * Stops calls when the credits run out.
 *
 * A call is only charged when it ends, so the balance does not move while it
 * runs. What can still be spent is therefore the balance less what the running
 * calls have used so far (credit.service availableCredits) - and when that
 * reaches zero every call in the workspace is ended, the same way a hang-up is,
 * with the reason "out of credits". Run on a timer, so a call can overrun by at
 * most one interval.
 *
 * It lives in the API, not the agent worker, so it covers every kind of call,
 * including vendors whose conversation never touches our worker.
 */
const EVERY_MS = 15_000;

export async function enforceCredits() {
  const active = await Conversation.find({ status: "active" }).select("_id workspaceId").lean();
  const byWorkspace = new Map();
  for (const c of active) {
    const key = String(c.workspaceId);
    byWorkspace.set(key, [...(byWorkspace.get(key) || []), c._id]);
  }

  let ended = 0;
  for (const [workspaceId, conversationIds] of byWorkspace) {
    if (await isUnlimited(workspaceId)) continue;
    if ((await availableCredits(workspaceId)) > 0) continue;

    for (const conversationId of conversationIds) {
      try {
        await roomService.endCall({ workspace: { _id: workspaceId }, conversationId, endReason: "out of credits" });
        ended += 1;
      } catch (err) {
        logger.warn({ err: err.message, conversationId: String(conversationId) }, "could not end a call out of credits");
      }
    }
    logger.info({ workspaceId, calls: conversationIds.length }, "calls ended: out of credits");
  }
  return ended;
}

/**
 * Charges calls that ended with minutes on the clock and no charge.
 *
 * A call is metered and then charged in two writes; if the process dies or the
 * database blinks between them, the call is in the usage ledger and not in the
 * credits ledger. Charging is idempotent per call, so catching it up is safe.
 * Only the last hour is looked at: this repairs a failed write, it does not
 * bill history.
 */
export async function chargeMissedCalls({ sinceMs = 60 * 60_000, limit = 50 } = {}) {
  const missed = await Conversation.find({
    status: { $in: ["ended", "failed"] },
    durationSec: { $gt: 0 },
    credits: { $in: [0, null] },
    endedAt: { $gt: new Date(Date.now() - sinceMs) },
  })
    .limit(limit)
    .lean();

  let charged = 0;
  for (const conversation of missed) {
    try {
      const result = await chargeConversation(conversation);
      if (result?.applied) charged += 1;
    } catch (err) {
      logger.warn({ err: err.message, conversationId: String(conversation._id) }, "could not charge a missed call");
    }
  }
  if (charged) logger.warn({ charged }, "charged calls that had ended without a charge");
  return charged;
}

/** Checks every fifteen seconds. Not started under test. */
export function startCreditEnforcer() {
  if (process.env.NODE_ENV === "test") return;
  let tick = 0;
  setInterval(() => {
    enforceCredits().catch((err) => logger.warn({ err: err.message }, "credit check failed"));
    // Once a minute is plenty for repairs.
    if (++tick % 4 === 0) chargeMissedCalls().catch((err) => logger.warn({ err: err.message }, "missed-call check failed"));
  }, EVERY_MS).unref();
}

/**
 * Tops up every workspace on a plan with this month's credits. Credits are also
 * granted whenever a balance is read, so this only matters for people who have
 * not looked yet - it keeps what an admin sees in step. Idempotent.
 */
export async function grantMonthlyCredits() {
  const subscriptions = await Subscription.find({ planId: { $ne: null } }).select("workspaceId").lean();
  for (const { workspaceId } of subscriptions) {
    await ensureGrants(workspaceId).catch((err) =>
      logger.warn({ err: err.message, workspaceId: String(workspaceId) }, "monthly credits failed"),
    );
  }
  return subscriptions.length;
}

/** Runs shortly after boot and then every half hour. Not started under test. */
export function startMonthlyGrants() {
  if (process.env.NODE_ENV === "test") return;
  setTimeout(() => grantMonthlyCredits().catch(() => {}), 30_000).unref();
  setInterval(() => grantMonthlyCredits().catch(() => {}), 30 * 60_000).unref();
}
