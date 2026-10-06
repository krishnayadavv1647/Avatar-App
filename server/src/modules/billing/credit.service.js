import {
  Conversation,
  CreditAccount,
  CreditTransaction,
  Plan,
  Subscription,
  SystemConfig,
} from "../../models/index.js";

/**
 * Credits - what calls are paid for in.
 *
 * A minute of conversation costs a number of credits that depends on how the
 * avatar is drawn (its render model): the better the picture, the dearer the
 * minute, in step with what the vendor charges us. A person sees a balance and
 * what it buys ("240 credits = 24 minutes on Standard, 40 on Flash"), a call
 * is charged for the seconds it really ran, and nothing starts - or keeps
 * running - once the balance is gone.
 *
 * Credits come from three places, all written to the same ledger: the plan's
 * monthly credits, an admin adding or removing some, and a purchased pack.
 * They do not expire.
 */
export const RENDER_MODELS = ["standard", "flash", "lite"];

/** Credits per minute. An admin can change them; these are the starting point. */
export const DEFAULT_RATES = Object.freeze({ standard: 10, flash: 6, lite: 4 });

/** What a new account with no plan starts with: ten minutes on Standard. */
export const DEFAULT_WELCOME_CREDITS = 100;

const RATES_KEY = "credit_rates";
const WELCOME_KEY = "welcome_credits";

export const round2 = (n) => Math.round(n * 100) / 100;

const fail = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, ...(code && { code }) });

// ---- settings ------------------------------------------------------------------

let ratesCache = null;

/** Credits per minute for each render model. Read often, changed rarely: cached briefly. */
export async function getRates() {
  if (ratesCache && Date.now() - ratesCache.at < 10_000) return ratesCache.value;

  const row = await SystemConfig.findOne({ key: RATES_KEY }).lean();
  let stored = {};
  try {
    stored = JSON.parse(row?.value || "{}");
  } catch {
    // A damaged value falls back to the defaults rather than blocking every call.
  }
  const value = { ...DEFAULT_RATES };
  for (const model of RENDER_MODELS) if (Number(stored[model]) > 0) value[model] = Number(stored[model]);

  ratesCache = { value, at: Date.now() };
  return value;
}

export async function getWelcomeCredits() {
  const row = await SystemConfig.findOne({ key: WELCOME_KEY }).lean();
  const value = Number(row?.value);
  return row && Number.isFinite(value) && value >= 0 ? value : DEFAULT_WELCOME_CREDITS;
}

export async function saveSettings({ rates, welcomeCredits }, adminId) {
  if (rates) {
    await SystemConfig.updateOne(
      { key: RATES_KEY },
      { $set: { value: JSON.stringify(rates), description: "Credits per minute, by render model", updatedBy: adminId } },
      { upsert: true },
    );
    ratesCache = null;
  }
  if (welcomeCredits !== undefined) {
    await SystemConfig.updateOne(
      { key: WELCOME_KEY },
      { $set: { value: String(welcomeCredits), description: "Credits for a new account with no plan", updatedBy: adminId } },
      { upsert: true },
    );
  }
  return { rates: await getRates(), welcomeCredits: await getWelcomeCredits() };
}

/** Credits per minute for an avatar: its render model's rate. */
export const rateFor = (rates, avatar) => rates[avatar?.render?.model] ?? rates.standard;

/** Minutes a number of credits buys at a rate, to a tenth, never rounded up. */
export const minutesFor = (credits, rate) => (rate > 0 ? Math.floor((Math.max(0, credits) / rate) * 10) / 10 : 0);

/** What a plan gives each month. Plans made before credits existed are worth their minutes at the Standard rate. */
export const planCredits = (plan, rates) => plan.monthlyCredits ?? Math.round((plan.includedMinutes || 0) * rates.standard);

// ---- the account ---------------------------------------------------------------

const periodKey = (date = new Date()) => date.toISOString().slice(0, 7);
const nextPeriodStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

async function planContext(workspaceId) {
  const subscription = await Subscription.findOne({ workspaceId }).lean();
  const plan = subscription?.planId ? await Plan.findById(subscription.planId).lean() : null;
  return { subscription, plan };
}

export async function isUnlimited(workspaceId) {
  const { plan } = await planContext(workspaceId);
  return Boolean(plan?.unlimitedCredits);
}

export async function getBalance(workspaceId) {
  const account = await CreditAccount.findOne({ workspaceId }).select("balance").lean();
  return round2(account?.balance || 0);
}

/**
 * Writes one ledger entry and moves the balance. With a `ref` it happens at most
 * once per workspace: a second attempt is recognised and does nothing, so a
 * retried webhook, a repeated check or two processes ending the same call
 * cannot credit or charge twice.
 *
 * @returns {Promise<{ applied: boolean, balance?: number }>}
 */
export async function applyTransaction({ workspaceId, kind, credits, ref, note, actorId, conversationId, meta }) {
  const amount = round2(credits);
  if (!amount) return { applied: false };

  let transaction;
  try {
    transaction = await CreditTransaction.create({ workspaceId, kind, credits: amount, ref, note, actorId, conversationId, meta });
  } catch (err) {
    if (err.code === 11000) return { applied: false };
    throw err;
  }

  const account = await CreditAccount.findOneAndUpdate(
    { workspaceId },
    { $inc: { balance: amount } },
    { upsert: true, new: true },
  );
  const balance = round2(account.balance);
  await CreditTransaction.updateOne({ _id: transaction._id }, { $set: { balanceAfter: balance } });
  return { applied: true, balance, transaction };
}

/**
 * Brings the account up to date with what it is owed: this month's plan credits,
 * or, for an account with no plan, the welcome credits once. Checked whenever
 * the balance is read, so a plan an admin assigns takes effect on the next look
 * and nothing needs a scheduled job.
 *
 * Plan credits are topped up to the plan's amount for the month, not added
 * twice: moving up a plan mid-month gives the difference, and moving back down
 * and up again gives nothing more.
 */
export async function ensureGrants(workspaceId) {
  const { subscription, plan } = await planContext(workspaceId);
  const rates = await getRates();

  // Bonus minutes, from before credits, become credits the first time they are seen.
  if (subscription?.bonusMinutes > 0) {
    await applyTransaction({
      workspaceId,
      kind: "admin_grant",
      credits: subscription.bonusMinutes * rates.standard,
      ref: "migrate-bonus-minutes",
      note: `Bonus minutes (${subscription.bonusMinutes}) converted to credits`,
    });
    await Subscription.updateOne({ workspaceId }, { $set: { bonusMinutes: 0 } });
  }

  if (plan) {
    if (plan.unlimitedCredits) return;
    const entitled = planCredits(plan, rates);
    const period = periodKey();
    const [row] = await CreditTransaction.aggregate([
      { $match: { workspaceId, kind: "plan_grant", "meta.period": period } },
      { $group: { _id: null, total: { $sum: "$credits" } } },
    ]);
    const owed = round2(entitled - (row?.total || 0));
    if (owed > 0) {
      await applyTransaction({
        workspaceId,
        kind: "plan_grant",
        credits: owed,
        ref: `plan:${period}:${plan._id}:${entitled}`,
        note: `Monthly credits (${plan.name})`,
        meta: { period, planId: String(plan._id), planName: plan.name },
      });
    }
    return;
  }

  const welcome = await getWelcomeCredits();
  if (welcome > 0) {
    await applyTransaction({
      workspaceId,
      kind: "signup_grant",
      credits: welcome,
      ref: "signup",
      note: "Welcome credits",
    });
  }
}

/** Credits being spent by calls that are running right now and not yet charged. */
export async function inFlightCredits(workspaceId, now = Date.now()) {
  const calls = await Conversation.find({ workspaceId, status: "active", startedAt: { $exists: true } })
    .select("startedAt creditRate")
    .lean();
  const rates = calls.some((c) => c.creditRate == null) ? await getRates() : null;
  return round2(
    calls.reduce((sum, c) => {
      const minutes = Math.max(0, now - new Date(c.startedAt).getTime()) / 60_000;
      return sum + minutes * (c.creditRate ?? rates.standard);
    }, 0),
  );
}

/** What can still be spent: the balance less what running calls have used so far. */
export async function availableCredits(workspaceId) {
  return round2((await getBalance(workspaceId)) - (await inFlightCredits(workspaceId)));
}

/**
 * Refuses a new call unless there is a minute's worth of credits left at the
 * avatar's rate. The message says what it costs, so the person knows what to do.
 */
export async function assertCanStartCall(workspaceId, rate) {
  await ensureGrants(workspaceId);
  if (await isUnlimited(workspaceId)) return;

  const available = await availableCredits(workspaceId);
  if (available < rate) {
    throw fail(
      402,
      `Not enough credits to start a call. You have ${Math.max(0, available)}, and a minute with this avatar costs ${rate}.`,
      "insufficient_credits",
    );
  }
}

/**
 * Charges a finished call for the seconds it ran, at the rate it started with.
 * Safe to call more than once for the same call.
 */
export async function chargeConversation(conversation) {
  if (!conversation?.durationSec || conversation.durationSec <= 0) return null;
  if (await isUnlimited(conversation.workspaceId)) return null;

  const rate = conversation.creditRate ?? (await getRates()).standard;
  const minutes = conversation.durationSec / 60;
  const credits = round2(minutes * rate);
  if (credits <= 0) return null;

  const result = await applyTransaction({
    workspaceId: conversation.workspaceId,
    kind: "usage",
    credits: -credits,
    ref: `usage:${conversation._id}`,
    note: "Call",
    conversationId: conversation._id,
    meta: { minutes: round2(minutes), rate },
  });
  if (result.applied) await Conversation.updateOne({ _id: conversation._id }, { $set: { credits } });
  return result;
}

/** An admin adding (positive) or removing (negative) credits, with the reason on record. */
export async function adjustCredits({ workspaceId, credits, note, actorId }) {
  await ensureGrants(workspaceId);
  if (credits < 0) {
    const balance = await getBalance(workspaceId);
    if (balance + credits < 0) throw fail(422, `They only have ${balance} credits, so ${Math.abs(credits)} cannot be removed.`);
  }
  const result = await applyTransaction({
    workspaceId,
    kind: credits > 0 ? "admin_grant" : "admin_deduct",
    credits,
    ref: `admin:${actorId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    note,
    actorId,
  });
  return result.balance;
}

/** What the credits screen shows. */
export async function summary(workspace) {
  const workspaceId = workspace._id;
  await ensureGrants(workspaceId);

  const [rates, { plan }, balance, inFlight] = await Promise.all([
    getRates(),
    planContext(workspaceId),
    getBalance(workspaceId),
    inFlightCredits(workspaceId),
  ]);
  const unlimited = Boolean(plan?.unlimitedCredits);
  const available = round2(balance - inFlight);

  return {
    balance,
    available,
    unlimited,
    rates,
    // What the credits buy at each rate: "240 credits = 24 minutes on Standard".
    equivalents: Object.fromEntries(RENDER_MODELS.map((m) => [m, minutesFor(available, rates[m])])),
    // Under five minutes of Standard left.
    low: !unlimited && available < rates.standard * 5,
    plan: plan ? { name: plan.name, monthlyCredits: planCredits(plan, rates), unlimited } : null,
    nextGrantAt: plan && !unlimited ? nextPeriodStart() : null,
  };
}

export async function listTransactions(workspaceId, { page = 1, limit = 20 } = {}) {
  const [transactions, total] = await Promise.all([
    CreditTransaction.find({ workspaceId })
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select("kind credits balanceAfter note createdAt conversationId meta")
      .lean(),
    CreditTransaction.countDocuments({ workspaceId }),
  ]);
  return { transactions, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

export const creditService = {
  getRates,
  getWelcomeCredits,
  saveSettings,
  rateFor,
  minutesFor,
  planCredits,
  getBalance,
  isUnlimited,
  applyTransaction,
  ensureGrants,
  inFlightCredits,
  availableCredits,
  assertCanStartCall,
  chargeConversation,
  adjustCredits,
  summary,
  listTransactions,
};
