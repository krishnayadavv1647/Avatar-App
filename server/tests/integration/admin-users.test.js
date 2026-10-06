/**
 * The admin Users tab: filtered lists, creating and editing accounts, the
 * admin-role rules, deleting with its cascade, and the CSV export.
 *
 * ADMIN_EMAILS is pinned to admin@example.com in setup-env.
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { signUp, startTestApp } from "../helpers.js";
import * as models from "../../src/models/index.js";

let app;
let admin;
let stock;

before(async () => {
  app = await startTestApp();
  admin = await signUp(app.baseUrl, { email: "admin@example.com", name: "Admin" });
  [stock] = (await admin.get("/api/studio/stock")).body.avatars;
});

after(() => app.stop());

let counter = 0;
const unique = (prefix) => `${prefix}-${(counter += 1)}-${Math.random().toString(36).slice(2, 6)}`;

const createPlan = (fields = {}) =>
  admin
    .post("/api/admin/plans", { key: unique("p"), name: unique("Plan"), ...fields })
    .then((r) => r.body.plan);

const createUser = (fields = {}) =>
  admin.post("/api/admin/users", {
    email: `${unique("made")}@example.com`,
    name: "Made User",
    password: "a-long-enough-password",
    ...fields,
  });

const login = (email, password = "a-long-enough-password") =>
  fetch(`${app.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

const auditActions = async (userId) =>
  (await models.AuditLog.find({ "target.id": String(userId) }).lean()).map((a) => a.action);

describe("listing", () => {
  test("filters by status, plan and source, and counts the active", async () => {
    const plan = await createPlan({ monthlyCredits: 300 });
    const manual = (await createUser({ planId: plan._id, organization: "Acme" })).body.user;
    const suspended = (await createUser({ status: "suspended" })).body.user;
    const signedUp = await signUp(app.baseUrl);

    const byPlan = (await admin.get(`/api/admin/users?plan=${plan._id}`)).body;
    assert.deepEqual(byPlan.users.map((u) => u.id), [manual.id]);

    const bySource = (await admin.get("/api/admin/users?source=manual")).body;
    assert.ok(bySource.users.every((u) => u.source === "manual"));
    assert.ok(bySource.users.some((u) => u.id === manual.id));

    const bySignup = (await admin.get("/api/admin/users?source=signup")).body;
    assert.ok(bySignup.users.some((u) => u.id === signedUp.user.id));
    assert.ok(bySignup.users.every((u) => u.source === "signup"));

    const gone = (await admin.get("/api/admin/users?status=suspended")).body;
    assert.ok(gone.users.some((u) => u.id === suspended.id));
    assert.ok(gone.users.every((u) => u.status === "suspended"));

    const live = (await admin.get("/api/admin/users?status=active")).body;
    assert.ok(live.users.every((u) => u.status === "active"));
    assert.equal(live.activeTotal, (await admin.get("/api/admin/users")).body.activeTotal);

    // Filters combine, and the search stays a literal.
    const both = (await admin.get(`/api/admin/users?plan=${plan._id}&status=suspended`)).body;
    assert.equal(both.total, 0);
  });

  test("each row carries what the screen shows: source, organization, workspace, plan credits and balance", async () => {
    const plan = await createPlan({ monthlyCredits: 450 });
    const made = (await createUser({ planId: plan._id, organization: "Acme", startingCredits: 150 })).body.user;

    const row = (await admin.get(`/api/admin/users?q=${encodeURIComponent(made.email)}`)).body.users[0];
    assert.equal(row.source, "manual");
    assert.equal(row.organization, "Acme");
    assert.equal(row.plan, plan.name);
    assert.equal(row.planCredits, 450);
    assert.equal(row.unlimited, false);
    // 100 welcome credits from sign-up, the plan's 450 and the 150 the admin started them with.
    assert.equal(row.credits, 700);
    assert.equal(row.planMinutes, undefined);
    assert.equal(row.bonusMinutes, undefined);
    assert.ok(row.workspace.name);
    assert.equal(row.role, "user");
  });

  test("pages of 30, newest first", async () => {
    const { body } = await admin.get("/api/admin/users");
    assert.equal(body.pageSize, 30);
    assert.ok(body.users.length <= 30);
    const dates = body.users.map((u) => new Date(u.createdAt).getTime());
    assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
  });

  test("rejects a filter it does not know", async () => {
    assert.equal((await admin.get("/api/admin/users?status=pending")).status, 400);
    assert.equal((await admin.get("/api/admin/users?source=google")).status, 400);
  });
});

describe("creating", () => {
  test("makes a real account: signs in, own workspace, source manual, plan and starting credits applied", async () => {
    const plan = await createPlan({ monthlyCredits: 600 });
    const { status, body } = await createUser({
      planId: plan._id,
      startingCredits: 200,
      organization: "Acme Inc",
      email: "Fresh.Person@Example.com",
    });

    assert.equal(status, 201);
    assert.equal(body.user.email, "fresh.person@example.com");
    assert.equal(body.user.source, "manual");
    assert.equal(body.user.organization, "Acme Inc");
    assert.equal(body.user.plan, plan.name);
    assert.equal(body.user.credits, 100 + 600 + 200);
    assert.equal(body.user.planCredits, 600);
    assert.equal(body.user.status, "active");

    const signedIn = await login("fresh.person@example.com");
    assert.equal(signedIn.status, 200);

    const detail = (await admin.get(`/api/admin/users/${body.user.id}`)).body;
    assert.equal(detail.credits.balance, 900);
    assert.equal(detail.credits.plan.monthlyCredits, 600);
    // The admin's gift is on the ledger, with the admin as its author.
    const ledger = (await admin.get(`/api/admin/users/${body.user.id}/credits`)).body.transactions;
    assert.ok(ledger.some((t) => t.kind === "admin_grant" && t.credits === 200));
    assert.ok(detail.workspace._id);

    assert.ok((await auditActions(body.user.id)).includes("admin.user.create"));
  });

  test("honours the status: a suspended account cannot sign in", async () => {
    const { body } = await createUser({ status: "suspended" });
    assert.equal(body.user.status, "suspended");
    const res = await login(body.user.email);
    assert.equal(res.status, 403);
  });

  test("creates an admin, who can open the admin routes at once", async () => {
    const { body } = await createUser({ role: "admin" });
    assert.equal(body.user.role, "admin");

    const session = await (await login(body.user.email)).json();
    const res = await fetch(`${app.baseUrl}/api/admin/stats`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    assert.equal(res.status, 200);
  });

  test("applies the same password rule as sign-up, refuses duplicates, and an admin made suspended", async () => {
    const weak = await createUser({ password: "short" });
    assert.equal(weak.status, 400);

    const first = await createUser();
    const dup = await createUser({ email: first.body.user.email.toUpperCase() });
    assert.equal(dup.status, 409);

    const oddAdmin = await createUser({ role: "admin", status: "suspended" });
    assert.equal(oddAdmin.status, 422);
  });

  test("refuses an archived or unknown plan before creating anything", async () => {
    const archived = await createPlan({ active: false });
    const email = `${unique("never")}@example.com`;
    const res = await createUser({ email, planId: archived._id });
    assert.equal(res.status, 422);
    assert.equal(await models.User.exists({ email }), null);
  });

  test("is for admins only", async () => {
    const user = await signUp(app.baseUrl);
    const res = await user.post("/api/admin/users", { email: "x@example.com", name: "X", password: "a-long-enough-password" });
    assert.equal(res.status, 403);
  });
});

describe("editing", () => {
  test("changes profile and plan in one save, and audits it", async () => {
    const before = await createPlan({ monthlyCredits: 100 });
    const after = await createPlan({ monthlyCredits: 900 });
    const user = (await createUser({ planId: before._id })).body.user;

    const { status, body } = await admin.patch(`/api/admin/users/${user.id}`, {
      name: "New Name",
      organization: "New Org",
      planId: after._id,
    });

    assert.equal(status, 200);
    assert.equal(body.user.name, "New Name");
    assert.equal(body.user.organization, "New Org");
    assert.equal(body.user.plan, after.name);
    assert.equal(body.user.planCredits, 900);
    // The new plan's credits are on the account straight away (welcome 100 + 100, then the 800 more).
    assert.equal(body.user.credits, 1000);
    // Mail is not set up in tests, and that is not an error.
    assert.equal(body.planEmail, "skipped");

    const actions = await auditActions(user.id);
    assert.ok(actions.includes("admin.user.update"));
    assert.ok(actions.includes("admin.plan.assign"));
  });

  test("leaves the plan alone when it did not change, and says no email was due", async () => {
    const plan = await createPlan();
    const user = (await createUser({ planId: plan._id })).body.user;
    const { body } = await admin.patch(`/api/admin/users/${user.id}`, { planId: plan._id, organization: "Same plan" });
    assert.equal(body.planEmail, "skipped");
    assert.ok(!(await auditActions(user.id)).includes("admin.plan.assign"));
  });

  test("suspends and reactivates, with the reason kept", async () => {
    const user = (await createUser()).body.user;

    const suspended = await admin.patch(`/api/admin/users/${user.id}`, { status: "suspended", blockReason: "Spam" });
    assert.equal(suspended.body.user.status, "suspended");
    assert.equal((await login(user.email)).status, 403);
    assert.equal((await admin.get(`/api/admin/users/${user.id}`)).body.user.blockedReason, "Spam");

    const active = await admin.patch(`/api/admin/users/${user.id}`, { status: "active" });
    assert.equal(active.body.user.status, "active");
    assert.equal((await login(user.email)).status, 200);
  });

  test("changes nothing when any part is refused", async () => {
    const archived = await createPlan({ active: false });
    const user = (await createUser({ organization: "Before" })).body.user;

    const res = await admin.patch(`/api/admin/users/${user.id}`, { organization: "After", planId: archived._id });
    assert.equal(res.status, 422);
    assert.equal((await models.User.findById(user.id).lean()).organization, "Before");
  });

  test("the email cannot be edited, and bad input is refused", async () => {
    const user = (await createUser()).body.user;
    assert.equal((await admin.patch(`/api/admin/users/${user.id}`, { email: "new@example.com" })).status, 400);
    assert.equal((await admin.patch(`/api/admin/users/${user.id}`, { bonusMinutes: 5 })).status, 400, "bonus minutes no longer exist");
    assert.equal((await admin.patch(`/api/admin/users/${user.id}`, { credits: 5 })).status, 400, "credits change through their own endpoint");
    assert.equal((await admin.patch(`/api/admin/users/${user.id}`, { status: "pending" })).status, 400);
    assert.equal((await admin.patch("/api/admin/users/000000000000000000000000", { name: "Ghost" })).status, 404);
  });

  test("is for admins only", async () => {
    const user = await signUp(app.baseUrl);
    const other = await signUp(app.baseUrl);
    assert.equal((await user.patch(`/api/admin/users/${other.user.id}`, { name: "Hacked" })).status, 403);
  });
});

describe("admin role", () => {
  test("promoting and demoting takes effect on the next request", async () => {
    const user = await signUp(app.baseUrl);
    assert.equal((await user.get("/api/admin/stats")).status, 403);

    const promoted = await admin.patch(`/api/admin/users/${user.user.id}`, { role: "admin" });
    assert.equal(promoted.body.user.role, "admin");
    assert.equal((await user.get("/api/admin/stats")).status, 200);
    assert.deepEqual((await user.get("/api/admin/access")).body, { admin: true });

    await admin.patch(`/api/admin/users/${user.user.id}`, { role: "user" });
    assert.equal((await user.get("/api/admin/stats")).status, 403);
  });

  test("a granted admin cannot be blocked or deleted until demoted", async () => {
    const user = await signUp(app.baseUrl);
    await admin.patch(`/api/admin/users/${user.user.id}`, { role: "admin" });

    assert.equal((await admin.post(`/api/admin/users/${user.user.id}/block`, {})).status, 422);
    assert.equal((await admin.patch(`/api/admin/users/${user.user.id}`, { status: "suspended" })).status, 422);
    assert.equal((await admin.del(`/api/admin/users/${user.user.id}`)).status, 422);

    // Promoting and suspending in one save is refused too.
    const other = await signUp(app.baseUrl);
    const both = await admin.patch(`/api/admin/users/${other.user.id}`, { role: "admin", status: "suspended" });
    assert.equal(both.status, 422);
  });

  test("an admin cannot demote themselves, and ADMIN_EMAILS cannot be demoted by anyone", async () => {
    const second = await signUp(app.baseUrl);
    await admin.patch(`/api/admin/users/${second.user.id}`, { role: "admin" });

    const self = await second.patch(`/api/admin/users/${second.user.id}`, { role: "user" });
    assert.equal(self.status, 422);
    assert.match(self.body.error.message, /your own admin access/);

    const superuser = await second.patch(`/api/admin/users/${admin.user.id}`, { role: "user" });
    assert.equal(superuser.status, 422);
    assert.match(superuser.body.error.message, /ADMIN_EMAILS/);
    assert.deepEqual((await admin.get("/api/admin/access")).body, { admin: true });
  });

  test("the list marks admins, and the superuser from ADMIN_EMAILS", async () => {
    const { body } = await admin.get(`/api/admin/users?q=${encodeURIComponent("admin@example.com")}`);
    assert.equal(body.users[0].role, "admin");
    assert.equal(body.users[0].superAdmin, true);
  });
});

describe("deleting", () => {
  test("erases the account and its workspace, keeping billing history without the personal parts", async () => {
    const user = await signUp(app.baseUrl);
    const { Avatar, ApiKey, Conversation, KnowledgeDocument, Subscription, Transcript, UsageLedger, User, Workspace, Invitation } =
      models;

    const avatar = (
      await user.post("/api/studio/stock", {
        providerId: stock.providerId,
        providerAvatarId: stock.providerAvatarId,
        name: "Face",
      })
    ).body.avatar;
    const shareToken = (await user.put(`/api/avatars/${avatar._id}/share`, { enabled: true })).body.share.token;
    await ApiKey.create({ userId: user.user.id, workspaceId: user.user.workspaceId, name: "k", prefix: "pre", hash: unique("h") });
    await KnowledgeDocument.create({
      workspaceId: user.user.workspaceId,
      avatarId: avatar._id,
      name: "doc.txt",
      text: "hello",
      chars: 5,
    });

    const conversation = await Conversation.create({
      workspaceId: user.user.workspaceId,
      avatarId: avatar._id,
      userId: user.user.id,
      source: "link",
      guest: { name: "Guest Gary", email: "gary@example.com" },
      roomName: unique("room"),
      providerId: "mock",
      pipelineMode: "render-only",
      transport: "livekit",
      status: "ended",
      durationSec: 120,
      costCents: 50,
    });
    await Transcript.create({
      conversationId: conversation._id,
      workspaceId: user.user.workspaceId,
      turns: [{ role: "user", text: "secret words", tsMs: Date.now() }],
    });
    await UsageLedger.create({
      workspaceId: user.user.workspaceId,
      conversationId: conversation._id,
      minutes: 2,
      costCents: 50,
    });
    await Invitation.create({
      email: user.email,
      tokenHash: unique("t"),
      expiresAt: new Date(Date.now() + 1000 * 60),
    });

    const { status, body } = await admin.del(`/api/admin/users/${user.user.id}`);
    assert.equal(status, 200);
    assert.equal(body.workspaceDeleted, true);
    assert.equal(body.avatars, 1);

    assert.equal(await User.exists({ _id: user.user.id }), null);
    assert.equal(await Workspace.exists({ _id: user.user.workspaceId }), null);
    assert.equal(await Subscription.exists({ workspaceId: user.user.workspaceId }), null);
    assert.equal(await Avatar.countDocuments({ workspaceId: user.user.workspaceId }), 0);
    assert.equal(await KnowledgeDocument.countDocuments({ workspaceId: user.user.workspaceId }), 0);
    assert.equal(await ApiKey.countDocuments({ userId: user.user.id }), 0);
    assert.equal(await Invitation.countDocuments({ email: user.email }), 0);

    // Billing history stays; what people said and who they were does not.
    assert.equal(await UsageLedger.countDocuments({ conversationId: conversation._id }), 1);
    assert.equal(await Transcript.countDocuments({ conversationId: conversation._id }), 0);
    const kept = await Conversation.findById(conversation._id).lean();
    assert.equal(kept.durationSec, 120);
    assert.equal(kept.guest, undefined);
    assert.equal(kept.userId, undefined);

    // The share link died with the avatar, and the person cannot come back in.
    assert.equal((await login(user.email, user.password)).status, 401);
    const share = await fetch(`${app.baseUrl}/api/links/${shareToken}`);
    assert.equal(share.status, 404);
  });

  test("is written to the deleting admin's audit log", async () => {
    const victim = (await createUser()).body.user;
    await admin.del(`/api/admin/users/${victim.id}`);
    const entry = await models.AuditLog.findOne({ action: "admin.user.delete", "target.id": victim.id }).lean();
    assert.equal(entry.meta.email, victim.email);
    assert.equal(String(entry.actorId), String(admin.user.id));
  });

  test("refuses yourself, an admin, and a workspace owner others still use", async () => {
    const self = await admin.del(`/api/admin/users/${admin.user.id}`);
    assert.equal(self.status, 422);

    const owner = await signUp(app.baseUrl);
    const member = await signUp(app.baseUrl);
    await models.User.updateOne({ _id: member.user.id }, { $set: { workspaceId: owner.user.workspaceId, role: "member" } });

    const shared = await admin.del(`/api/admin/users/${owner.user.id}`);
    assert.equal(shared.status, 409);
    assert.match(shared.body.error.message, /1 other person uses/);
    assert.ok(await models.Workspace.exists({ _id: owner.user.workspaceId }));

    // A member can go without taking the workspace along.
    const gone = await admin.del(`/api/admin/users/${member.user.id}`);
    assert.equal(gone.status, 200);
    assert.equal(gone.body.workspaceDeleted, false);
    assert.ok(await models.Workspace.exists({ _id: owner.user.workspaceId }));
  });

  test("404s an unknown user, and is for admins only", async () => {
    assert.equal((await admin.del("/api/admin/users/000000000000000000000000")).status, 404);
    const user = await signUp(app.baseUrl);
    const other = await signUp(app.baseUrl);
    assert.equal((await user.del(`/api/admin/users/${other.user.id}`)).status, 403);
  });
});

describe("CSV export", () => {
  const fetchCsv = (client, query = "") =>
    fetch(`${app.baseUrl}/api/admin/users/export.csv${query}`, { headers: { authorization: `Bearer ${client.token}` } });

  test("exports every page with the same filters as the list", async () => {
    const plan = await createPlan({ monthlyCredits: 500 });
    const a = (await createUser({ planId: plan._id, name: "Exported, \"Quoted\" Person", startingCredits: 50 })).body.user;
    await createUser({ planId: plan._id });

    const res = await fetchCsv(admin, `?plan=${plan._id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    assert.match(res.headers.get("content-disposition"), /users_export_\d{4}-\d{2}-\d{2}\.csv/);

    const text = (await res.text()).replace(/^﻿/, "");
    const lines = text.split("\r\n");
    assert.equal(
      lines[0],
      '"Name","Email","Plan","Status","Plan Credits","Credits","Source","Organization","Workspace","Created Date"',
    );
    assert.equal(lines.length, 3, "header plus the two users on that plan");
    assert.ok(text.includes('"Exported, ""Quoted"" Person"'));
    assert.ok(text.includes(`"${a.email}","${plan.name}","active","500","650","manual"`));
  });

  test("exports more than one page worth", async () => {
    // 35 accounts is past the 30-a-page of the list.
    for (let i = 0; i < 35; i += 1) {
      await models.User.create({ email: `bulk-${i}-${counter}@example.com`, name: `Bulk ${i}`, source: "invited" });
    }
    const text = await (await fetchCsv(admin, "?source=invited")).text();
    assert.ok(text.split("\r\n").length >= 36);
  });

  test("neutralises spreadsheet formulas", async () => {
    const evil = (await createUser({ name: "=HYPERLINK(\"http://evil.test\",\"x\")", organization: "@SUM(1)" })).body.user;
    const text = await (await fetchCsv(admin, `?q=${encodeURIComponent(evil.email)}`)).text();
    assert.ok(text.includes(`"'=HYPERLINK(""http://evil.test"",""x"")"`));
    assert.ok(text.includes(`"'@SUM(1)"`));
    assert.ok(!/(^|,)"=/m.test(text), "no cell may begin with =");
  });

  test("is for admins only", async () => {
    const user = await signUp(app.baseUrl);
    assert.equal((await fetchCsv(user)).status, 403);
    assert.equal((await fetch(`${app.baseUrl}/api/admin/users/export.csv`)).status, 401);
  });
});

describe("credits an admin gives", () => {
  const credits = (user) => admin.get(`/api/admin/users/${user.id}/credits`).then((r) => r.body);
  const adjust = (user, change, note = "For a test") =>
    admin.post(`/api/admin/users/${user.id}/credits`, { credits: change, note });

  test("raise the balance, and are kept when the plan changes", async () => {
    const plan = await createPlan({ monthlyCredits: 200 });
    const next = await createPlan({ monthlyCredits: 400 });
    const user = (await createUser({ planId: plan._id })).body.user;
    assert.equal((await credits(user)).balance, 300, "100 welcome + the plan's 200");

    const added = await adjust(user, 50);
    assert.equal(added.status, 200);
    assert.equal(added.body.balance, 350);

    await admin.put(`/api/admin/users/${user.id}/plan`, { planId: next._id });
    const after = await credits(user);
    // The plan top-up (200 more this month) came on top; the gift was not undone.
    assert.equal(after.balance, 550);
    assert.ok(after.transactions.some((t) => t.kind === "admin_grant" && t.credits === 50));
  });

  test("can be taken back, but never below zero, and each change needs a reason", async () => {
    const user = (await createUser()).body.user;

    const taken = await adjust(user, -30);
    assert.equal(taken.body.balance, 70);
    assert.ok((await credits(user)).transactions.some((t) => t.kind === "admin_deduct" && t.credits === -30));

    const tooMuch = await adjust(user, -100_000);
    assert.equal(tooMuch.status, 422);
    assert.equal((await credits(user)).balance, 70);

    assert.equal((await adjust(user, 5, "")).status, 400);
    assert.equal((await adjust(user, 0)).status, 400);
    assert.equal((await adjust(user, 1.5)).status, 400);
  });

  test("are written to the audit log, and only admins can give them", async () => {
    const user = (await createUser()).body.user;
    await adjust(user, 25, "Goodwill after an outage");
    const entry = await models.AuditLog.findOne({ action: "credits.grant", "target.id": user.id }).lean();
    assert.equal(entry.meta.note, "Goodwill after an outage");

    const other = await signUp(app.baseUrl);
    assert.equal((await other.post(`/api/admin/users/${user.id}/credits`, { credits: 5, note: "Sneaky" })).status, 403);
    assert.equal((await other.get(`/api/admin/users/${user.id}/credits`)).status, 403);
  });

  test("starting credits on create go through the ledger", async () => {
    const user = (await createUser({ startingCredits: 75 })).body.user;
    const account = await credits(user);
    assert.equal(account.balance, 175);
    assert.ok(account.transactions.some((t) => t.kind === "admin_grant" && t.credits === 75));

    assert.equal((await createUser({ startingCredits: -5 })).status, 400);
    assert.equal((await createUser({ bonusMinutes: 5 })).status, 400);
  });
});
