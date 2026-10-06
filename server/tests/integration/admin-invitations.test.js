/**
 * Inviting someone onto a plan: the admin side that makes the invitation and
 * the public side that opens and accepts the link.
 *
 * ADMIN_EMAILS is pinned to admin@example.com in setup-env, and no mail
 * provider is configured, so every send answers "Email is not configured".
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { signUp, startTestApp } from "../helpers.js";
import * as models from "../../src/models/index.js";

let app;
let admin;
let plan;

before(async () => {
  app = await startTestApp();
  admin = await signUp(app.baseUrl, { email: "admin@example.com", name: "Admin" });
  plan = (await admin.post("/api/admin/plans", { key: "invited", name: "Invited Plan", monthlyCredits: 770 })).body.plan;
});

after(() => app.stop());

let counter = 0;
const email = () => `invitee-${(counter += 1)}-${Math.random().toString(36).slice(2, 6)}@example.com`;

const invite = (fields = {}) =>
  admin.post("/api/admin/invitations", { email: email(), planId: plan._id, ...fields });

const tokenOf = (link) => link.split("/invite/")[1];

const anon = async (method, path, body) => {
  const res = await fetch(`${app.baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

describe("creating", () => {
  test("makes a pending invitation with a link, and says when the email could not be sent", async () => {
    const to = email();
    const { status, body } = await invite({ email: to, role: "admin", message: "Welcome <b>aboard</b>" });

    assert.equal(status, 201);
    assert.equal(body.emailSent, false);
    assert.equal(body.emailError, "Email is not configured");
    assert.match(body.link, /\/invite\/[A-Za-z0-9_-]{40,}$/);
    assert.equal(body.invitation.status, "pending");
    assert.equal(body.invitation.role, "admin");
    assert.equal(body.invitation.plan.name, "Invited Plan");

    const days = (new Date(body.invitation.expiresAt) - Date.now()) / 86_400_000;
    assert.ok(days > 6.9 && days <= 7, "expires in seven days");
  });

  test("stores only a hash of the token, and who invited", async () => {
    const { body } = await invite();
    const token = tokenOf(body.link);
    const stored = await models.Invitation.findById(body.invitation.id).lean();

    assert.notEqual(stored.tokenHash, token);
    assert.equal(stored.tokenHash.length, 64);
    assert.equal(JSON.stringify(stored).includes(token), false);
    assert.equal(String(stored.invitedBy), String(admin.user.id));
  });

  test("tokens are not repeated", async () => {
    const tokens = new Set();
    for (let i = 0; i < 5; i += 1) tokens.add(tokenOf((await invite()).body.link));
    assert.equal(tokens.size, 5);
  });

  test("refuses an archived or unknown plan, bad input, and non-admins", async () => {
    const archived = (await admin.post("/api/admin/plans", { key: "old-one", name: "Old", active: false })).body.plan;
    assert.equal((await invite({ planId: archived._id })).status, 422);
    assert.equal((await invite({ planId: "000000000000000000000000" })).status, 404);
    assert.equal((await invite({ email: "not-an-email" })).status, 400);
    assert.equal((await invite({ role: "owner" })).status, 400);
    assert.equal((await invite({ planId: undefined })).status, 400);

    const user = await signUp(app.baseUrl);
    assert.equal((await user.post("/api/admin/invitations", { email: email(), planId: plan._id })).status, 403);
  });

  test("is recorded in the admin's audit log", async () => {
    const { body } = await invite();
    const entry = await models.AuditLog.findOne({ action: "admin.invitation.create", "target.id": String(body.invitation.id) }).lean();
    assert.ok(entry);
    assert.equal(String(entry.actorId), String(admin.user.id));
  });
});

describe("listing", () => {
  test("shows recent invitations, counts the pending ones in the stats, and never shows a link", async () => {
    const before = (await admin.get("/api/admin/stats")).body.pendingInvites;
    const { body } = await invite();
    assert.equal((await admin.get("/api/admin/stats")).body.pendingInvites, before + 1);

    const list = (await admin.get("/api/admin/invitations")).body;
    const row = list.invitations.find((i) => i.id === body.invitation.id);
    assert.equal(row.status, "pending");
    assert.equal(row.invitedBy, "admin@example.com");
    assert.equal(JSON.stringify(list).includes(tokenOf(body.link)), false);
    assert.ok(list.invitations.length <= 20);

    const pending = (await admin.get("/api/admin/invitations?status=pending")).body;
    assert.ok(pending.invitations.every((i) => i.status === "pending"));
  });

  test("an overdue pending invitation reads as expired, and is not counted as pending", async () => {
    const { body } = await invite();
    await models.Invitation.updateOne({ _id: body.invitation.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const expired = (await admin.get("/api/admin/invitations?status=expired")).body;
    assert.ok(expired.invitations.some((i) => i.id === body.invitation.id));
    const pending = (await admin.get("/api/admin/invitations?status=pending")).body;
    assert.ok(!pending.invitations.some((i) => i.id === body.invitation.id));
  });
});

describe("opening the link", () => {
  test("describes the invitation to anyone with the link", async () => {
    const to = email();
    const { body } = await invite({ email: to, message: "Hello there" });
    const { status, body: page } = await anon("GET", `/api/invitations/${tokenOf(body.link)}`);

    assert.equal(status, 200);
    assert.equal(page.invitation.email, to);
    assert.equal(page.invitation.plan.name, "Invited Plan");
    assert.equal(page.invitation.plan.monthlyCredits, 770);
    assert.equal(page.invitation.plan.unlimited, false);
    assert.equal(page.invitation.plan.includedMinutes, undefined);
    assert.equal(page.invitation.status, "pending");
    assert.equal(page.invitation.message, "Hello there");
    assert.equal(page.invitation.tokenHash, undefined);
  });

  test("404s a link that is not valid", async () => {
    const { status } = await anon("GET", `/api/invitations/${"x".repeat(43)}`);
    assert.equal(status, 404);
  });

  test("410s an expired or revoked link, and marks it expired", async () => {
    const { body } = await invite();
    await models.Invitation.updateOne({ _id: body.invitation.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const gone = await anon("GET", `/api/invitations/${tokenOf(body.link)}`);
    assert.equal(gone.status, 410);
    assert.equal((await models.Invitation.findById(body.invitation.id).lean()).status, "expired");

    const second = await invite();
    assert.equal((await admin.del(`/api/admin/invitations/${second.body.invitation.id}`)).status, 200);
    assert.equal((await anon("GET", `/api/invitations/${tokenOf(second.body.link)}`)).status, 410);
  });
});

describe("accepting", () => {
  test("puts the invited account on the plan, records the source, and marks it accepted", async () => {
    const to = email();
    const { body } = await invite({ email: to });
    // Signing up after being invited is what makes the account an invited one.
    const user = await signUp(app.baseUrl, { email: to });

    const { status, body: result } = await user.post(`/api/invitations/${tokenOf(body.link)}/accept`);
    assert.equal(status, 200);
    assert.equal(result.success, true);
    assert.equal(result.planName, "Invited Plan");
    assert.equal(result.role, "user");

    const detail = (await admin.get(`/api/admin/users/${user.user.id}`)).body;
    assert.equal(detail.subscription.planName, "Invited Plan");
    const account = (await admin.get(`/api/admin/users/${user.user.id}/credits`)).body;
    assert.equal(account.plan.monthlyCredits, 770);
    // The welcome credits from sign-up, and the plan's credits from accepting.
    assert.equal(account.balance, 100 + 770);
    assert.equal(detail.user.source, "invited");
    assert.equal(detail.user.admin, false);

    const stored = await models.Invitation.findById(body.invitation.id).lean();
    assert.equal(stored.status, "accepted");
    assert.equal(String(stored.acceptedBy), String(user.user.id));
  });

  test("an admin invitation makes an admin", async () => {
    const to = email();
    const { body } = await invite({ email: to, role: "admin" });
    const user = await signUp(app.baseUrl, { email: to });

    const { body: result } = await user.post(`/api/invitations/${tokenOf(body.link)}/accept`);
    assert.equal(result.role, "admin");
    assert.equal((await user.get("/api/admin/stats")).status, 200);
  });

  test("a user invitation never takes admin away", async () => {
    const to = email();
    const user = await signUp(app.baseUrl, { email: to });
    await admin.patch(`/api/admin/users/${user.user.id}`, { role: "admin" });

    const { body } = await invite({ email: to, role: "user" });
    await user.post(`/api/invitations/${tokenOf(body.link)}/accept`);
    assert.equal((await user.get("/api/admin/stats")).status, 200);
  });

  test("an established account keeps its source when handed a plan", async () => {
    const to = email();
    const user = await signUp(app.baseUrl, { email: to });
    const { body } = await invite({ email: to });
    await user.post(`/api/invitations/${tokenOf(body.link)}/accept`);
    assert.equal((await admin.get(`/api/admin/users/${user.user.id}`)).body.user.source, "signup");
  });

  test("matches the email without regard to case, and refuses anyone else", async () => {
    const to = email();
    const { body } = await invite({ email: to });
    const token = tokenOf(body.link);

    const stranger = await signUp(app.baseUrl);
    const refused = await stranger.post(`/api/invitations/${token}/accept`);
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.message, `This invitation was sent to ${to}. Please sign in with that email address.`);
    assert.equal((await models.Invitation.findById(body.invitation.id).lean()).status, "pending");

    const owner = await signUp(app.baseUrl, { email: to.toUpperCase() });
    assert.equal((await owner.post(`/api/invitations/${token}/accept`)).status, 200);
  });

  test("a second accept succeeds without doing it twice", async () => {
    const to = email();
    const { body } = await invite({ email: to });
    const user = await signUp(app.baseUrl, { email: to });
    const url = `/api/invitations/${tokenOf(body.link)}/accept`;

    assert.equal((await user.post(url)).body.alreadyAccepted, undefined);
    const again = await user.post(url);
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadyAccepted, true);
  });

  test("two accepts at once apply it once", async () => {
    const to = email();
    const { body } = await invite({ email: to });
    const user = await signUp(app.baseUrl, { email: to });
    const url = `/api/invitations/${tokenOf(body.link)}/accept`;

    const results = await Promise.all([user.post(url), user.post(url)]);
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(results.filter((r) => r.body.alreadyAccepted).length, 1);
  });

  test("refuses an expired link, and marks it expired", async () => {
    const to = email();
    const { body } = await invite({ email: to });
    const user = await signUp(app.baseUrl, { email: to });
    await models.Invitation.updateOne({ _id: body.invitation.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const { status, body: result } = await user.post(`/api/invitations/${tokenOf(body.link)}/accept`);
    assert.equal(status, 410);
    assert.equal(result.error.message, "This invitation has expired. Please ask for a new one.");
    assert.equal((await models.Invitation.findById(body.invitation.id).lean()).status, "expired");
  });

  test("needs a signed-in account, and an archived plan stops it without using up the link", async () => {
    const to = email();
    const { body } = await invite({ email: to });
    const url = `/api/invitations/${tokenOf(body.link)}/accept`;
    assert.equal((await anon("POST", url)).status, 401);

    const user = await signUp(app.baseUrl, { email: to });
    await admin.patch(`/api/admin/plans/${plan._id}`, { active: false });
    assert.equal((await user.post(url)).status, 410);
    assert.equal((await models.Invitation.findById(body.invitation.id).lean()).status, "pending");

    await admin.patch(`/api/admin/plans/${plan._id}`, { active: true });
    assert.equal((await user.post(url)).status, 200);
  });
});

describe("revoking", () => {
  test("cancels a pending invitation, but not an accepted one", async () => {
    const { body } = await invite();
    assert.equal((await admin.del(`/api/admin/invitations/${body.invitation.id}`)).status, 200);
    const listed = (await admin.get("/api/admin/invitations?status=expired")).body.invitations;
    assert.ok(listed.some((i) => i.id === body.invitation.id));

    const to = email();
    const accepted = await invite({ email: to });
    const user = await signUp(app.baseUrl, { email: to });
    await user.post(`/api/invitations/${tokenOf(accepted.body.link)}/accept`);
    assert.equal((await admin.del(`/api/admin/invitations/${accepted.body.invitation.id}`)).status, 409);

    assert.equal((await admin.del("/api/admin/invitations/000000000000000000000000")).status, 404);
  });
});
