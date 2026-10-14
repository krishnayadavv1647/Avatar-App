/**
 * The credit rate went from 10 to 25 a Standard minute. This is the one-off that
 * multiplies balances (and explicit plan / pack credits) so nobody's minutes
 * shrink: a 500-credit balance is still fifty minutes.
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import {
  Conversation,
  CreditAccount,
  CreditPack,
  CreditTransaction,
  Plan,
  Subscription,
  SystemConfig,
} from "../../src/models/index.js";
import { applyTransaction } from "../../src/modules/billing/credit.service.js";
import { migrateCreditRate } from "../../src/modules/billing/rateMigration.js";
import { signUp, startTestApp } from "../helpers.js";

let app;

before(async () => {
  app = await startTestApp({ seed: false });
});

after(() => app.stop());

const period = () => new Date().toISOString().slice(0, 7);

/** An account holding exactly `balance`, with nothing else in its ledger that matters. */
async function account(balance) {
  const user = await signUp(app.baseUrl);
  const workspaceId = user.user.workspaceId;
  await CreditAccount.updateOne({ workspaceId }, { $set: { balance } });
  return workspaceId;
}

const balanceOf = async (workspaceId) => (await CreditAccount.findOne({ workspaceId }).lean()).balance;

/** The migration only ever touches what it is pointed at: here, the accounts these tests made. */
const ours = (result, ...ids) => result.accounts.filter((r) => ids.map(String).includes(r.workspaceId));

// Each test uses its own factor, so the "already done" markers and ledger refs never collide.
describe("balances", () => {
  test("a dry run says what it would do and changes nothing", async () => {
    const ws = await account(500);
    const result = await migrateCreditRate({ factor: 2.5, apply: false });
    assert.equal(result.ok, true);
    assert.equal(result.applied, false);
    assert.deepEqual(ours(result, ws).map((r) => [r.before, r.after]), [[500, 1250]]);
    assert.equal(await balanceOf(ws), 500);
    assert.equal(await CreditTransaction.countDocuments({ workspaceId: ws, note: /rate change/i }), 0);
  });

  test("multiplies a balance, with one ledger entry, and does nothing the second time", async () => {
    const ws = await account(500);
    const first = await migrateCreditRate({ factor: 2.5, apply: true });
    assert.equal(first.ok, true);
    assert.equal(await balanceOf(ws), 1250);

    const entries = await CreditTransaction.find({ workspaceId: ws, ref: "rate-change:x2.5" }).lean();
    assert.equal(entries.length, 1);
    assert.deepEqual([entries[0].kind, entries[0].credits, entries[0].balanceAfter], ["admin_grant", 750, 1250]);

    await migrateCreditRate({ factor: 2.5, apply: true });
    assert.equal(await balanceOf(ws), 1250, "never multiplied twice");
    assert.equal(await CreditTransaction.countDocuments({ workspaceId: ws, ref: "rate-change:x2.5" }), 1);
  });

  test("an overdrawn balance is made more overdrawn by the same factor", async () => {
    const ws = await account(-4);
    await migrateCreditRate({ factor: 3, apply: true });
    assert.equal(await balanceOf(ws), -12);
    const entry = await CreditTransaction.findOne({ workspaceId: ws, ref: "rate-change:x3" }).lean();
    assert.deepEqual([entry.kind, entry.credits], ["admin_deduct", -8]);
  });

  test("a zero balance is left alone", async () => {
    const ws = await account(0);
    await migrateCreditRate({ factor: 2, apply: true });
    assert.equal(await CreditTransaction.countDocuments({ workspaceId: ws, ref: "rate-change:x2" }), 0);
  });
});

describe("accounts on a plan", () => {
  /** A plan from before credits (minutes only), a subscription on it, and this month's grant at the OLD rate. */
  async function onLegacyPlan({ minutes, grant, balance }) {
    const ws = await account(0);
    const plan = await Plan.create({
      key: `legacy-${Math.random().toString(36).slice(2, 8)}`,
      name: "Legacy",
      includedMinutes: minutes,
    });
    await Subscription.updateOne({ workspaceId: ws }, { $set: { planId: plan._id } }, { upsert: true });
    await CreditAccount.updateOne({ workspaceId: ws }, { $set: { balance: 0 } });
    await CreditTransaction.deleteMany({ workspaceId: ws });
    if (grant) {
      await applyTransaction({
        workspaceId: ws,
        kind: "plan_grant",
        credits: grant,
        ref: `old-grant-${ws}`,
        meta: { period: period() },
      });
    }
    await CreditAccount.updateOne({ workspaceId: ws }, { $set: { balance } });
    return ws;
  }

  test("an unspent plan month ends at the multiple, not the multiple plus a second top-up", async () => {
    // 100 minutes was 1,000 credits at 10 a minute; the balance is the whole grant.
    const ws = await onLegacyPlan({ minutes: 100, grant: 1000, balance: 1000 });
    await migrateCreditRate({ factor: 2.5, apply: true, force: true });
    assert.equal(await balanceOf(ws), 2500, "100 minutes, now 2,500 credits - and no more");
  });

  test("a partly spent month keeps what was left, scaled", async () => {
    const ws = await onLegacyPlan({ minutes: 100, grant: 1000, balance: 200 });
    // Distinct factor so the earlier run's ref does not apply to this account.
    const result = await migrateCreditRate({ factor: 2.5, apply: true, force: true });
    assert.equal(result.ok, true);
    assert.equal(await balanceOf(ws), 500, "20 minutes left before, 20 minutes left after");
  });
});

describe("plans and packs", () => {
  test("explicit plan credits and packs are multiplied once", async () => {
    const plan = await Plan.create({ key: `explicit-${Date.now()}`, name: "Explicit", monthlyCredits: 20 });
    const pack = await CreditPack.create({ name: "Big", credits: 1000, priceCents: 2900 });

    const first = await migrateCreditRate({ factor: 1.5, apply: true, force: true });
    assert.equal(first.alreadyScaled, false);
    assert.equal((await Plan.findById(plan._id).lean()).monthlyCredits, 30);
    assert.equal((await CreditPack.findById(pack._id).lean()).credits, 1500);
    assert.ok(await SystemConfig.findOne({ key: "credit_rate_migration:x1.5" }));

    const second = await migrateCreditRate({ factor: 1.5, apply: true, force: true });
    assert.equal(second.alreadyScaled, true);
    assert.equal((await Plan.findById(plan._id).lean()).monthlyCredits, 30, "not scaled twice");
    assert.equal((await CreditPack.findById(pack._id).lean()).credits, 1500);
  });

  test("a dry run does not touch plans", async () => {
    const plan = await Plan.create({ key: `dry-${Date.now()}`, name: "Dry", monthlyCredits: 40 });
    const result = await migrateCreditRate({ factor: 1.25, apply: false });
    assert.ok(result.plans.some((p) => p.name === "Dry" && p.from === 40 && p.to === 50));
    assert.equal((await Plan.findById(plan._id).lean()).monthlyCredits, 40);
  });
});

describe("calls in progress", () => {
  test("refuses to apply while a call is running, unless forced", async () => {
    const ws = await account(100);
    const user = await signUp(app.baseUrl);
    const { body } = await user.post("/api/studio/stock", { providerId: "library", providerAvatarId: "face_f01", name: "Caller" });
    const call = await Conversation.create({
      workspaceId: user.user.workspaceId,
      avatarId: body.avatar._id,
      userId: user.user.id,
      roomName: `call-${Math.random().toString(36).slice(2)}`,
      providerId: "mock",
      pipelineMode: "render-only",
      transport: "livekit",
      status: "active",
      startedAt: new Date(),
      creditRate: 10,
    });

    const refused = await migrateCreditRate({ factor: 4, apply: true });
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /in progress/);
    assert.equal(await balanceOf(ws), 100, "nothing changed");

    // A dry run is always allowed: it changes nothing.
    assert.equal((await migrateCreditRate({ factor: 4, apply: false })).ok, true);

    await Conversation.updateOne({ _id: call._id }, { $set: { status: "ended" } });
    assert.equal((await migrateCreditRate({ factor: 4, apply: true })).ok, true);
    assert.equal(await balanceOf(ws), 400);
  });
});
