import { Conversation, Subscription } from "../../models/index.js";
import { roomService } from "../rooms/room.service.js";
import { availableCredits, ensureGrants, isUnlimited } from "./credit.service.js";
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

/** Checks every fifteen seconds. Not started under test. */
export function startCreditEnforcer() {
  if (process.env.NODE_ENV === "test") return;
  setInterval(() => enforceCredits().catch((err) => logger.warn({ err: err.message }, "credit check failed")), EVERY_MS).unref();
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
