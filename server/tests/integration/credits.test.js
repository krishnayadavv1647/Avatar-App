/**
 * Credits: what calls are paid for in. A balance, what it buys, grants from a
 * plan or an admin, a charge for the seconds a call really ran, and nothing
 * starting - or running - once the balance is gone.
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import {
  AuditLog,
  Avatar,
  Conversation,
  CreditAccount,
  CreditTransaction,
  Plan,
  Subscription,
} from "../../src/models/index.js";
import { creditService } from "../../src/modules/billing/credit.service.js";
import { enforceCredits, grantMonthlyCredits } from "../../src/modules/billing/creditEnforcer.js";
import { signUp, startTestApp } from "../helpers.js";

let app;
let admin;

before(async () => {
  app = await startTestApp({ seed: false });
  admin = await signUp(app.baseUrl, { email: "admin@example.com", name: "Admin" });
});

after(() => app.stop());

const person = () => signUp(app.baseUrl);
const credits = async (user) => (await user.get("/api/billing/credits")).body;

async function avatarFor(user, { model } = {}) {
  const { body } = await user.post("/api/studio/stock", {
    providerId: "library",
    providerAvatarId: "face_f01",
    name: "Caller",
  });
  const id = body.avatar._id;
  if (model) await Avatar.updateOne({ _id: id }, { $set: { "render.model": model } });
  return id;
}

/** A call that has been running for `minutes`, as the worker would have left it. */
const runningCall = (user, avatarId, { minutes, rate = 10 }) =>
  Conversation.create({
    workspaceId: user.user.workspaceId,
    avatarId,
    userId: user.user.id,
    roomName: `call-${Math.random().toString(36).slice(2)}`,
    providerId: "mock",
    pipelineMode: "render-only",
    transport: "livekit",
    status: "active",
    startedAt: new Date(Date.now() - minutes * 60_000),
    creditRate: rate,
  });

const planWith = (fields) =>
  Plan.create({ key: `p-${Math.random().toString(36).slice(2, 8)}`, name: "Test plan", ...fields });

const putOnPlan = async (user, plan) => {
  const res = await admin.put(`/api/admin/users/${user.user.id}/plan`, { planId: String(plan._id) });
  assert.equal(res.status, 200);
};

describe("a new account", () => {
  test("starts with welcome credits, once, and is told what they buy", async () => {
    const user = await person();
    const first = await credits(user);

    assert.equal(first.balance, 100);
    assert.equal(first.available, 100);
    assert.deepEqual(first.rates, { standard: 10, flash: 6, lite: 4 });
    // 100 credits: ten minutes of Standard, sixteen and a bit of Flash, twenty-five of Lite.
    assert.deepEqual(first.equivalents, { standard: 10, flash: 16.6, lite: 25 });
    assert.equal(first.unlimited, false);

    // Looking again never grants again.
    assert.equal((await credits(user)).balance, 100);
    const { body } = await user.get("/api/billing/credit-transactions");
    assert.deepEqual(body.transactions.map((t) => [t.kind, t.credits, t.balanceAfter]), [["signup_grant", 100, 100]]);
  });

  test("the welcome amount is the admin's to set", async () => {
    assert.equal((await admin.put("/api/admin/credits/settings", { welcomeCredits: 250 })).status, 200);
    try {
      assert.equal((await credits(await person())).balance, 250);
    } finally {
      await admin.put("/api/admin/credits/settings", { welcomeCredits: 100 });
    }
  });
});

describe("rates", () => {
  test("an admin sets credits per minute for each render model", async () => {
    const user = await person();
    const saved = await admin.put("/api/admin/credits/settings", { rates: { standard: 20, flash: 10, lite: 5 } });
    try {
      assert.equal(saved.status, 200);
      const summary = await credits(user);
      assert.deepEqual(summary.rates, { standard: 20, flash: 10, lite: 5 });
      assert.deepEqual(summary.equivalents, { standard: 5, flash: 10, lite: 20 });
    } finally {
      await admin.put("/api/admin/credits/settings", { rates: { standard: 10, flash: 6, lite: 4 } });
    }
  });

  test("refuses a rate that is not a positive number, and anyone but an admin", async () => {
    const user = await person();
    assert.equal((await admin.put("/api/admin/credits/settings", { rates: { standard: 0, flash: 6, lite: 4 } })).status, 400);
    assert.equal((await admin.put("/api/admin/credits/settings", { rates: { standard: -1, flash: 6, lite: 4 } })).status, 400);
    assert.equal((await user.put("/api/admin/credits/settings", { welcomeCredits: 5 })).status, 403);
    assert.equal((await user.get("/api/admin/credits/settings")).status, 403);
  });
});

describe("plans", () => {
  test("a plan's monthly credits arrive when it is assigned, and not twice", async () => {
    const user = await person();
    const plan = await planWith({ monthlyCredits: 500 });

    await putOnPlan(user, plan);
    assert.equal((await credits(user)).balance, 600, "100 welcome + 500 from the plan");
    await putOnPlan(user, plan);
    assert.equal((await credits(user)).balance, 600);
    assert.equal((await credits(user)).plan.monthlyCredits, 500);
  });

  test("moving up mid-month gives the difference; moving down and up again gives nothing more", async () => {
    const user = await person();
    const small = await planWith({ monthlyCredits: 500 });
    const big = await planWith({ monthlyCredits: 800 });

    await putOnPlan(user, small);
    await putOnPlan(user, big);
    assert.equal((await credits(user)).balance, 100 + 800);
    await putOnPlan(user, small);
    await putOnPlan(user, big);
    assert.equal((await credits(user)).balance, 100 + 800);
  });

  test("a plan from before credits is worth its minutes at the Standard rate", async () => {
    const user = await person();
    await putOnPlan(user, await planWith({ includedMinutes: 50 }));
    assert.equal((await credits(user)).plan.monthlyCredits, 500);
    assert.equal((await credits(user)).balance, 600);
  });

  test("an unlimited plan has no balance to run out of, and calls on it cost nothing", async () => {
    const user = await person();
    await putOnPlan(user, await planWith({ unlimitedCredits: true }));
    const avatarId = await avatarFor(user);

    const summary = await credits(user);
    assert.equal(summary.unlimited, true);
    assert.equal(summary.nextGrantAt, null);

    // Even with the welcome credits taken away, a call starts.
    await CreditAccount.updateOne({ workspaceId: user.user.workspaceId }, { $set: { balance: 0 } });
    const started = await user.post("/api/rooms", { avatarId });
    assert.equal(started.status, 201);

    await Conversation.updateOne(
      { _id: started.body.conversationId },
      { $set: { status: "active", startedAt: new Date(Date.now() - 600_000) } },
    );
    await user.del(`/api/rooms/${started.body.conversationId}`);
    assert.equal(await creditService.getBalance(user.user.workspaceId), 0);
  });

  test("bonus minutes from before credits become credits, once", async () => {
    const user = await person();
    await credits(user);
    await Subscription.updateOne({ workspaceId: user.user.workspaceId }, { $set: { bonusMinutes: 5 } });

    assert.equal((await credits(user)).balance, 100 + 50);
    assert.equal((await credits(user)).balance, 150);
    assert.equal((await Subscription.findOne({ workspaceId: user.user.workspaceId }).lean()).bonusMinutes, 0);
  });

  test("the monthly top-up reaches people who have not looked yet", async () => {
    const user = await person();
    const plan = await planWith({ monthlyCredits: 300 });
    // Put straight onto the plan, as if assigned before this month's credits were due.
    await Subscription.updateOne(
      { workspaceId: user.user.workspaceId },
      { $set: { planId: plan._id, plan: plan.key } },
      { upsert: true },
    );
    assert.equal(await creditService.getBalance(user.user.workspaceId), 100);

    await grantMonthlyCredits();
    assert.equal(await creditService.getBalance(user.user.workspaceId), 400);
    await grantMonthlyCredits();
    assert.equal(await creditService.getBalance(user.user.workspaceId), 400);
  });
});

describe("starting a call", () => {
  test("is refused, with what it costs, when there is less than a minute of credits", async () => {
    const user = await person();
    const avatarId = await avatarFor(user);
    await admin.post(`/api/admin/users/${user.user.id}/credits`, { credits: -95, note: "test: leave five" });

    const { status, body } = await user.post("/api/rooms", { avatarId });

    assert.equal(status, 402);
    assert.equal(body.error.code, "insufficient_credits");
    assert.match(body.error.message, /You have 5, and a minute with this avatar costs 10/);
    assert.equal(await Conversation.countDocuments({ workspaceId: user.user.workspaceId }), 0, "nothing was created");
  });

  test("the minute's price is the avatar's render model's", async () => {
    const user = await person();
    await admin.post(`/api/admin/users/${user.user.id}/credits`, { credits: -95, note: "test: leave five" });

    // Five credits is not a minute of Standard (10) but is a minute of Lite (4).
    const standard = await avatarFor(user);
    assert.equal((await user.post("/api/rooms", { avatarId: standard })).status, 402);

    const lite = await avatarFor(user, { model: "lite" });
    const ok = await user.post("/api/rooms", { avatarId: lite });
    assert.equal(ok.status, 201);
    assert.equal((await Conversation.findById(ok.body.conversationId).lean()).creditRate, 4);
  });

  test("credits being used by a call that is running already are not available again", async () => {
    const user = await person();
    const avatarId = await avatarFor(user);
    // Two minutes in at 10 a minute is twenty of the hundred spoken for... and a long call is the rest.
    await runningCall(user, avatarId, { minutes: 9.5, rate: 10 });

    const { status } = await user.post("/api/rooms", { avatarId });
    assert.equal(status, 402, "95 of 100 are spoken for, leaving less than a minute");
  });
});

describe("charging a call", () => {
  test("costs the seconds it ran at the rate it started with", async () => {
    const user = await person();
    const avatarId = await avatarFor(user);
    const call = await runningCall(user, avatarId, { minutes: 5, rate: 6 });

    await user.del(`/api/rooms/${call._id}`);

    const charged = await CreditTransaction.findOne({ conversationId: call._id }).lean();
    assert.equal(charged.kind, "usage");
    assert.ok(Math.abs(charged.credits + 30) < 0.5, `5 minutes at 6 is about 30, got ${charged.credits}`);
    assert.ok(Math.abs((await creditService.getBalance(user.user.workspaceId)) - 70) < 0.5);
    assert.ok((await Conversation.findById(call._id).lean()).credits > 29);
  });

  test("a rate change while a call runs does not reprice it", async () => {
    const user = await person();
    const avatarId = await avatarFor(user);
    const call = await runningCall(user, avatarId, { minutes: 10, rate: 4 });
    await admin.put("/api/admin/credits/settings", { rates: { standard: 100, flash: 100, lite: 100 } });
    try {
      await user.del(`/api/rooms/${call._id}`);
    } finally {
      await admin.put("/api/admin/credits/settings", { rates: { standard: 10, flash: 6, lite: 4 } });
    }
    const charged = await CreditTransaction.findOne({ conversationId: call._id }).lean();
    assert.ok(Math.abs(charged.credits + 40) < 0.5, `10 minutes at the starting 4 is about 40, got ${charged.credits}`);
  });

  test("ending a call twice charges it once", async () => {
    const user = await person();
    const avatarId = await avatarFor(user);
    const call = await runningCall(user, avatarId, { minutes: 2, rate: 10 });

    await user.del(`/api/rooms/${call._id}`);
    await user.del(`/api/rooms/${call._id}`);
    const usage = await CreditTransaction.find({ conversationId: call._id }).lean();
    assert.equal(usage.length, 1);
  });

  test("a call that never connected costs nothing", async () => {
    const user = await person();
    const avatarId = await avatarFor(user);
    const started = await user.post("/api/rooms", { avatarId });
    await user.del(`/api/rooms/${started.body.conversationId}`);
    assert.equal(await creditService.getBalance(user.user.workspaceId), 100);
  });
});

describe("running out", () => {
  test("a call that has used up the balance is ended, and says why", async () => {
    const user = await person();
    const avatarId = await avatarFor(user);
    const call = await runningCall(user, avatarId, { minutes: 12, rate: 10 });

    assert.equal(await enforceCredits(), 1);

    const ended = await Conversation.findById(call._id).lean();
    assert.equal(ended.status, "ended");
    assert.equal(ended.endReason, "out of credits");
    // Charged for what it used, so the next call is refused at once.
    assert.ok((await creditService.getBalance(user.user.workspaceId)) <= 0);
    assert.equal((await user.post("/api/rooms", { avatarId })).status, 402);
  });

  test("a call with credits to spare is left alone, and so are other people's", async () => {
    const poor = await person();
    const rich = await person();
    const poorCall = await runningCall(poor, await avatarFor(poor), { minutes: 12, rate: 10 });
    const richCall = await runningCall(rich, await avatarFor(rich), { minutes: 3, rate: 10 });

    await enforceCredits();

    assert.equal((await Conversation.findById(poorCall._id).lean()).status, "ended");
    assert.equal((await Conversation.findById(richCall._id).lean()).status, "active");
    await rich.del(`/api/rooms/${richCall._id}`);
  });

  test("every call in the workspace ends together, since they share one balance", async () => {
    const user = await person();
    const avatarId = await avatarFor(user);
    const a = await runningCall(user, avatarId, { minutes: 6, rate: 10 });
    const b = await runningCall(user, avatarId, { minutes: 6, rate: 10 });

    assert.equal(await enforceCredits(), 2);
    for (const call of [a, b]) assert.equal((await Conversation.findById(call._id).lean()).endReason, "out of credits");
  });

  test("an unlimited workspace is never stopped", async () => {
    const user = await person();
    await putOnPlan(user, await planWith({ unlimitedCredits: true }));
    const call = await runningCall(user, await avatarFor(user), { minutes: 600, rate: 10 });

    await enforceCredits();
    assert.equal((await Conversation.findById(call._id).lean()).status, "active");
    await user.del(`/api/rooms/${call._id}`);
  });
});

describe("an admin changing someone's credits", () => {
  test("adds and removes, with the reason kept and the audit trail written", async () => {
    const user = await person();
    await credits(user);

    const added = await admin.post(`/api/admin/users/${user.user.id}/credits`, { credits: 40, note: "Goodwill for the outage" });
    assert.equal(added.body.balance, 140);
    const removed = await admin.post(`/api/admin/users/${user.user.id}/credits`, { credits: -15, note: "Corrected a double grant" });
    assert.equal(removed.body.balance, 125);

    const history = (await user.get("/api/billing/credit-transactions")).body.transactions;
    assert.deepEqual(history.slice(0, 2).map((t) => [t.kind, t.credits, t.note, t.balanceAfter]), [
      ["admin_deduct", -15, "Corrected a double grant", 125],
      ["admin_grant", 40, "Goodwill for the outage", 140],
    ]);
    const audits = await AuditLog.find({ workspaceId: user.user.workspaceId, action: /^credits\./ }).lean();
    assert.deepEqual(audits.map((a) => a.action).sort(), ["credits.deduct", "credits.grant"]);
  });

  test("cannot take away more than they have, add nothing, or skip the reason", async () => {
    const user = await person();
    await credits(user);
    const url = `/api/admin/users/${user.user.id}/credits`;

    const tooMuch = await admin.post(url, { credits: -101, note: "too much" });
    assert.equal(tooMuch.status, 422);
    assert.match(tooMuch.body.error.message, /only have 100/);
    assert.equal((await admin.post(url, { credits: 0, note: "nothing" })).status, 400);
    assert.equal((await admin.post(url, { credits: 5 })).status, 400);
    assert.equal((await admin.post(url, { credits: 5, note: "ok" })).status, 400);
    assert.equal(await creditService.getBalance(user.user.workspaceId), 100);
  });

  test("is for admins only", async () => {
    const user = await person();
    const other = await person();
    assert.equal((await user.post(`/api/admin/users/${other.user.id}/credits`, { credits: 5, note: "give me some" })).status, 403);
    assert.equal((await user.get(`/api/admin/users/${other.user.id}/credits`)).status, 403);
  });

  test("an admin can read a user's balance and recent history", async () => {
    const user = await person();
    await admin.post(`/api/admin/users/${user.user.id}/credits`, { credits: 10, note: "for the test" });
    const { status, body } = await admin.get(`/api/admin/users/${user.user.id}/credits`);
    assert.equal(status, 200);
    assert.equal(body.balance, 110);
    assert.equal(body.transactions.length, 2);
    assert.ok(body.rates.standard);
  });

  test("shows up in the user list as their balance", async () => {
    const user = await person();
    await admin.post(`/api/admin/users/${user.user.id}/credits`, { credits: 25, note: "for the list" });
    const { body } = await admin.get(`/api/admin/users?q=${encodeURIComponent(user.email)}`);
    assert.equal(body.users[0].credits, 125);
  });
});

describe("packs for sale", () => {
  test("an admin makes them, and people see only the active ones, cheapest order first", async () => {
    const user = await person();
    const small = await admin.post("/api/admin/credit-packs", { name: "Small", credits: 500, priceCents: 500 });
    const big = await admin.post("/api/admin/credit-packs", { name: "Big", credits: 5000, priceCents: 4000, badge: "Best value", displayOrder: 2 });
    await admin.post("/api/admin/credit-packs", { name: "Hidden", credits: 100, priceCents: 100, active: false });
    try {
      assert.equal(small.status, 201);
      const { packs } = await credits(user);
      assert.deepEqual(packs.map((p) => p.name), ["Small", "Big"]);
      assert.equal(packs[1].badge, "Best value");
      assert.equal("active" in packs[0], false);
    } finally {
      for (const p of [small, big]) await admin.del(`/api/admin/credit-packs/${p.body.pack._id}`);
    }
  });

  test("checks what an admin enters", async () => {
    assert.equal((await admin.post("/api/admin/credit-packs", { name: "", credits: 10, priceCents: 500 })).status, 400);
    assert.equal((await admin.post("/api/admin/credit-packs", { name: "Free", credits: 10, priceCents: 0 })).status, 400);
    assert.equal((await admin.post("/api/admin/credit-packs", { name: "Cheap", credits: 10, priceCents: 49 })).status, 400);
    assert.equal((await admin.post("/api/admin/credit-packs", { name: "Zero", credits: 0, priceCents: 500 })).status, 400);
    assert.equal((await (await person()).post("/api/admin/credit-packs", { name: "Mine", credits: 10, priceCents: 500 })).status, 403);
  });

  test("can be edited and removed", async () => {
    const made = (await admin.post("/api/admin/credit-packs", { name: "Edit me", credits: 100, priceCents: 500 })).body.pack;
    const edited = await admin.patch(`/api/admin/credit-packs/${made._id}`, { credits: 150, active: false });
    assert.equal(edited.body.pack.credits, 150);
    assert.equal(edited.body.pack.active, false);
    assert.equal((await admin.del(`/api/admin/credit-packs/${made._id}`)).status, 200);
    assert.equal((await admin.del(`/api/admin/credit-packs/${made._id}`)).status, 404);
  });
});

describe("the history", () => {
  test("is a person's own, newest first, and pages", async () => {
    const user = await person();
    const other = await person();
    for (let i = 0; i < 25; i += 1) await admin.post(`/api/admin/users/${user.user.id}/credits`, { credits: 1, note: `top-up ${i}` });
    await admin.post(`/api/admin/users/${other.user.id}/credits`, { credits: 7, note: "not yours" });

    const first = (await user.get("/api/billing/credit-transactions")).body;
    assert.equal(first.total, 26);
    assert.equal(first.pages, 2);
    assert.equal(first.transactions.length, 20);
    assert.equal(first.transactions[0].note, "top-up 24");
    assert.ok(first.transactions.every((t) => t.note !== "not yours"));

    const second = (await user.get("/api/billing/credit-transactions?page=2")).body;
    assert.equal(second.transactions.length, 6);
  });

  test("the platform's ledger can be filtered by kind and by person", async () => {
    const user = await person();
    await admin.post(`/api/admin/users/${user.user.id}/credits`, { credits: 3, note: "for the ledger" });

    const byKind = (await admin.get("/api/admin/credit-transactions?kind=admin_grant")).body;
    assert.ok(byKind.transactions.length > 0);
    assert.ok(byKind.transactions.every((t) => t.kind === "admin_grant"));

    const byPerson = (await admin.get(`/api/admin/credit-transactions?q=${encodeURIComponent(user.email)}`)).body;
    assert.ok(byPerson.transactions.length >= 2);
    assert.ok(byPerson.transactions.every((t) => t.user.email === user.email));
    assert.equal((await user.get("/api/admin/credit-transactions")).status, 403);
  });

  test("needs a signed-in person", async () => {
    assert.equal((await fetch(`${app.baseUrl}/api/billing/credits`)).status, 401);
  });
});

describe("the ledger's guarantees", () => {
  test("the same grant applied twice credits once", async () => {
    const user = await person();
    const workspaceId = user.user.workspaceId;
    await credits(user); // the welcome credits, so the starting point is known
    const once = await creditService.applyTransaction({ workspaceId, kind: "purchase", credits: 500, ref: "stripe:cs_test_1", note: "Credit pack" });
    const again = await creditService.applyTransaction({ workspaceId, kind: "purchase", credits: 500, ref: "stripe:cs_test_1", note: "Credit pack" });

    assert.equal(once.applied, true);
    assert.equal(again.applied, false);
    assert.equal(await creditService.getBalance(workspaceId), 100 + 500);
  });

  test("two processes ending the same call at once charge it once", async () => {
    const user = await person();
    const avatarId = await avatarFor(user);
    const call = await runningCall(user, avatarId, { minutes: 3, rate: 10 });
    await Promise.all([user.del(`/api/rooms/${call._id}`), user.del(`/api/rooms/${call._id}`)]);
    assert.equal(await CreditTransaction.countDocuments({ conversationId: call._id }), 1);
  });

  test("fractions of a credit do not drift", async () => {
    const user = await person();
    const workspaceId = user.user.workspaceId;
    await credits(user);
    for (let i = 0; i < 10; i += 1) {
      await creditService.applyTransaction({ workspaceId, kind: "admin_grant", credits: 0.1, ref: `tenth-${i}`, note: "tenth" });
    }
    assert.equal(await creditService.getBalance(workspaceId), 101);
  });
});
