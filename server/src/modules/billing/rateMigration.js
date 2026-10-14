import { Conversation, CreditAccount, CreditPack, CreditTransaction, Plan, Subscription, SystemConfig } from "../../models/index.js";
import { applyTransaction, ensureGrants, getRates, round2 } from "./credit.service.js";

/**
 * One-off: the credit rate went from 10 to 25 a Standard minute, so every balance
 * is multiplied to keep it buying the same minutes (a 500-credit balance is
 * still fifty minutes, as the person was told).
 *
 * What it does, per workspace, is what the person would expect:
 *
 *   - their balance is multiplied by `factor` with one ledger entry ("admin_grant"
 *     when it goes up), carrying a `ref` per workspace so running it twice does
 *     nothing the second time;
 *   - a workspace on a plan first gets this month's top-up (the plan's credits
 *     are derived from its minutes at the new rate, and are granted by
 *     `ensureGrants`); that top-up is counted as part of the multiplication, not
 *     on top of it, so nobody is paid twice for the same plan;
 *   - plans with explicit monthly credits and credit packs are multiplied once
 *     (a marker row records it), so a plan still gives the same minutes.
 *
 * It refuses to run while calls are in progress: a call is charged at the rate it
 * started with, and finishing at the old rate against a multiplied balance would
 * undercharge it.
 *
 * @param {{ factor?: number, apply?: boolean, force?: boolean }} options
 */
export async function migrateCreditRate({ factor = 2.5, apply = false, force = false } = {}) {
  const tag = `x${factor}`;
  const ref = `rate-change:${tag}`;
  const marker = `credit_rate_migration:${tag}`;
  const period = new Date().toISOString().slice(0, 7);

  const active = await Conversation.countDocuments({ status: { $in: ["pending", "active"] } });
  if (apply && active && !force) {
    return { ok: false, reason: `${active} call(s) are in progress. Run it when there are none, or pass force.`, active };
  }

  const rates = await getRates();
  const alreadyScaled = Boolean(await SystemConfig.findOne({ key: marker }).lean());

  // ---- plans and packs, once
  const plans = await Plan.find({ monthlyCredits: { $ne: null } }).lean();
  const packs = await CreditPack.find().lean();
  const scaledPlans = [];
  if (!alreadyScaled) {
    for (const plan of plans) {
      const to = Math.round(plan.monthlyCredits * factor);
      scaledPlans.push({ name: plan.name, from: plan.monthlyCredits, to });
      if (apply) await Plan.updateOne({ _id: plan._id }, { $set: { monthlyCredits: to } });
    }
    for (const pack of packs) {
      const to = Math.round(pack.credits * factor);
      scaledPlans.push({ name: `pack ${pack.name}`, from: pack.credits, to });
      if (apply) await CreditPack.updateOne({ _id: pack._id }, { $set: { credits: to } });
    }
  }

  // ---- balances
  const accounts = await CreditAccount.find({ balance: { $ne: 0 } }).lean();
  const rows = [];

  for (const account of accounts) {
    const workspaceId = account.workspaceId;
    const subscription = await Subscription.findOne({ workspaceId }).lean();
    const plan = subscription?.planId ? await Plan.findById(subscription.planId).lean() : null;
    const before = round2(account.balance);

    // What this month's top-up will be, at the new rate and scaled plan.
    let topup = 0;
    if (plan && !plan.unlimitedCredits) {
      const monthly =
        plan.monthlyCredits != null
          ? alreadyScaled || apply
            ? plan.monthlyCredits // already scaled above when applying
            : Math.round(plan.monthlyCredits * factor)
          : Math.round((plan.includedMinutes || 0) * rates.standard);
      const [granted] = await CreditTransaction.aggregate([
        { $match: { workspaceId, kind: "plan_grant", "meta.period": period } },
        { $group: { _id: null, total: { $sum: "$credits" } } },
      ]);
      topup = Math.max(0, round2(monthly - (granted?.total || 0)));
    }

    const target = round2(before * factor);
    const delta = round2(target - before - topup);
    rows.push({ workspaceId: String(workspaceId), before, topup, delta, after: round2(before + topup + delta) });

    if (!apply) continue;

    if (plan) await ensureGrants(workspaceId); // the top-up, at the new rate
    if (Math.abs(delta) >= 0.005) {
      await applyTransaction({
        workspaceId,
        kind: delta > 0 ? "admin_grant" : "admin_deduct",
        credits: delta,
        ref,
        note: `Credit rate change: credits now buy the same minutes (x${factor})`,
        meta: { migration: tag },
      });
    }
  }

  if (apply && !alreadyScaled) {
    await SystemConfig.updateOne(
      { key: marker },
      { $set: { value: new Date().toISOString(), description: `Plans and packs scaled by ${tag}` } },
      { upsert: true },
    );
  }

  return { ok: true, applied: apply, factor, calls: active, plans: scaledPlans, alreadyScaled, accounts: rows };
}
