import { Avatar, Conversation, Plan, Subscription, UsageLedger } from "../../models/index.js";
import { CAPABILITIES } from "../../avatar/capabilities.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

/**
 * Metering and the limits that depend on it.
 *
 * Cost is computed from the duration we actually observed, never from the
 * planning estimate in the capability matrix - that figure exists to route and
 * forecast, and billing from it would drift from reality the moment a vendor
 * changed price mid-month.
 *
 * The ledger is append-only. Corrections are new rows, so a disputed invoice
 * can always be replayed rather than reconstructed.
 */
export const usageService = {
  /**
   * Writes a conversation's usage exactly once.
   *
   * Idempotent on conversationId, because both the hang-up request and the
   * transport's own disconnect event can plausibly land here.
   */
  async recordConversation(conversation) {
    const existing = await UsageLedger.findOne({
      conversationId: conversation._id,
      kind: "conversation",
    }).lean();
    if (existing) return existing;

    const minutes = Math.max(0, conversation.durationSec || 0) / 60;
    const rate = CAPABILITIES[conversation.providerId]?.approxCostPerMinUsd ?? 0;
    const costCents = Math.round(minutes * rate * 100);

    let entry;
    try {
      entry = await UsageLedger.create({
        workspaceId: conversation.workspaceId,
        conversationId: conversation._id,
        providerId: conversation.providerId,
        minutes: Number(minutes.toFixed(3)),
        costCents,
        kind: "conversation",
      });
    } catch (err) {
      // Lost a race with another process finishing the same call; its entry
      // stands. The unique index is what makes this safe.
      if (err.code === 11000) {
        return UsageLedger.findOne({ conversationId: conversation._id, kind: "conversation" }).lean();
      }
      throw err;
    }

    await Conversation.updateOne({ _id: conversation._id }, { $set: { costCents } });

    logger.info(
      { conversationId: String(conversation._id), minutes: entry.minutes, costCents },
      "usage recorded",
    );
    return entry;
  },

  /**
   * Calls currently holding a vendor session.
   *
   * Counts `pending` as well as `active`: a call that has been issued a token
   * but whose participant has not connected yet is still a reserved slot, and
   * ignoring it would let someone open unlimited sessions by never joining.
   */
  activeCallCount(workspaceId) {
    return Conversation.countDocuments({
      workspaceId,
      status: { $in: ["pending", "active"] },
    });
  },

  /**
   * Refuses a new call when the workspace is already at its ceiling.
   *
   * Concurrency is the limit that protects spend and vendor quota at the same
   * time, so it is enforced before a session is created rather than reported
   * afterwards.
   */
  async assertCanStartCall(workspace) {
    const limits = await this.limitsFor(workspace);
    const limit = limits.concurrencyLimit;
    const active = await this.activeCallCount(workspace._id);

    if (active >= limit) {
      const err = new Error(
        `This workspace already has ${active} call(s) running and its limit is ${limit}.`,
      );
      err.statusCode = 429;
      throw err;
    }

    if (limits.overageEnabled) return;

    const used = await this.minutesThisPeriod(workspace._id);
    // Bonus minutes ride on top of a metered plan. An unmetered one (0 included)
    // stays unmetered: a bonus must not turn "no cap" into a small one.
    const included = limits.allowanceMinutes;

    // Zero included minutes means the plan is not metered this way (the free
    // tier during development), not that every call should be refused.
    if (included > 0 && used >= included) {
      const err = new Error(
        `Monthly allowance used (${used.toFixed(1)} of ${included} minutes). ` +
          `Enable overage in billing to keep going.`,
      );
      err.statusCode = 402;
      throw err;
    }
  },

  /**
   * The limits a workspace runs under.
   *
   * With an assigned plan they come from the plan, read now rather than copied
   * at assignment, so editing a plan changes it for everyone on it. Without
   * one they are the older per-subscription and per-workspace fields.
   */
  async limitsFor(workspace) {
    const subscription = await Subscription.findOne({ workspaceId: workspace._id }).lean();
    const plan = subscription?.planId ? await Plan.findById(subscription.planId).lean() : null;

    if (plan) {
      return {
        planId: plan._id,
        planName: plan.name,
        ...minutesFor(plan.includedMinutes, subscription.bonusMinutes),
        overageEnabled: Boolean(plan.overageEnabled),
        concurrencyLimit: plan.concurrencyLimit ?? 3,
        maxAvatars: plan.maxAvatars ?? 0,
      };
    }
    return {
      planId: null,
      planName: subscription?.plan || null,
      ...minutesFor(subscription?.includedMinutes, subscription?.bonusMinutes),
      // No subscription at all has always meant "not metered".
      overageEnabled: subscription ? Boolean(subscription.overageEnabled) : true,
      concurrencyLimit: workspace.settings?.concurrencyLimit ?? 3,
      maxAvatars: 0,
    };
  },

  /** Refuses a new avatar once the plan's avatar count is reached (0 = no cap). */
  async assertCanCreateAvatar(workspace) {
    const { maxAvatars, planName } = await this.limitsFor(workspace);
    if (!maxAvatars) return;

    const count = await Avatar.countDocuments({ workspaceId: workspace._id });
    if (count >= maxAvatars) {
      const err = new Error(
        `Your ${planName || "current"} plan allows ${maxAvatars} avatar${maxAvatars === 1 ? "" : "s"}. ` +
          `Delete one or ask for a bigger plan.`,
      );
      err.statusCode = 402;
      throw err;
    }
  },

  async minutesThisPeriod(workspaceId, since = startOfMonth()) {
    const [row] = await UsageLedger.aggregate([
      { $match: { workspaceId, createdAt: { $gte: since } } },
      { $group: { _id: null, minutes: { $sum: "$minutes" }, costCents: { $sum: "$costCents" } } },
    ]);
    return row?.minutes ?? 0;
  },

  async summary(workspaceId) {
    const since = startOfMonth();

    const byProvider = await UsageLedger.aggregate([
      { $match: { workspaceId, createdAt: { $gte: since } } },
      {
        $group: {
          _id: "$providerId",
          minutes: { $sum: "$minutes" },
          costCents: { $sum: "$costCents" },
          calls: { $sum: 1 },
        },
      },
      { $sort: { costCents: -1 } },
    ]);

    const subscription = await Subscription.findOne({ workspaceId }).lean();
    // Only the displayed fields are read, so the workspace's own settings are not needed.
    const limits = subscription ? await this.limitsFor({ _id: workspaceId }) : null;

    // Derived from the per-provider rows rather than a second aggregate, so the
    // two can never disagree.
    const totals = byProvider.reduce(
      (acc, p) => ({
        minutes: acc.minutes + p.minutes,
        costCents: acc.costCents + p.costCents,
        calls: acc.calls + p.calls,
      }),
      { minutes: 0, costCents: 0, calls: 0 },
    );

    return {
      periodStart: since,
      totals: { ...totals, minutes: Number(totals.minutes.toFixed(2)) },
      byProvider: byProvider.map((p) => ({
        providerId: p._id,
        minutes: Number(p.minutes.toFixed(2)),
        costCents: p.costCents,
        calls: p.calls,
      })),
      activeCalls: await this.activeCallCount(workspaceId),
      plan: limits
        ? {
            name: limits.planName,
            includedMinutes: limits.includedMinutes,
            bonusMinutes: limits.bonusMinutes,
            allowanceMinutes: limits.allowanceMinutes,
            overageEnabled: limits.overageEnabled,
            maxAvatars: limits.maxAvatars,
          }
        : null,
      maxCallSeconds: env.maxCallSeconds,
    };
  },
};

/**
 * What a workspace may use each month: the plan's minutes plus any bonus an
 * admin granted. Both are returned so screens can show them apart; the sum is
 * what is enforced.
 */
function minutesFor(includedMinutes, bonusMinutes) {
  const included = includedMinutes ?? 0;
  const bonus = bonusMinutes ?? 0;
  return {
    includedMinutes: included,
    bonusMinutes: bonus,
    allowanceMinutes: included > 0 ? included + bonus : 0,
  };
}

function startOfMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
