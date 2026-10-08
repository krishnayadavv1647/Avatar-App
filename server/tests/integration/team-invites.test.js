/**
 * Inviting people to a workspace by link: an owner or admin makes a link, whoever
 * opens it makes an account inside that workspace with the role on the link, and
 * the link stops working when it is used up, expires or is cancelled.
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { AuditLog, TeamInvite, User } from "../../src/models/index.js";
import { signIn, signUp, startTestApp } from "../helpers.js";

let app;

before(async () => {
  app = await startTestApp({ seed: false });
});

after(() => app.stop());

const PASSWORD = "a-long-password-1";
const newcomer = (over = {}) => ({ name: "Ravi Nair", email: `ravi-${Math.random().toString(36).slice(2, 8)}@example.com`, password: PASSWORD, ...over });
const tokenOf = (link) => link.split("/join/")[1];

const post = async (path, body) => {
  const res = await fetch(`${app.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const get = async (path) => {
  const res = await fetch(`${app.baseUrl}${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
};
const join = (link, person = newcomer()) => post(`/api/join/${tokenOf(link)}`, person);

describe("making links", () => {
  test("an owner makes a link, and the token is shown once and never listed", async () => {
    const owner = await signUp(app.baseUrl);
    const res = await owner.post("/api/team/invites", { role: "member", expiresInDays: 7, maxUses: 3 });
    assert.equal(res.status, 201);
    assert.match(res.body.link, /\/join\/[A-Za-z0-9_-]{40,}$/);
    assert.deepEqual([res.body.invite.role, res.body.invite.maxUses, res.body.invite.uses], ["member", 3, 0]);

    const listed = await owner.get("/api/team/invites");
    assert.equal(listed.body.invites.length, 1);
    assert.ok(!JSON.stringify(listed.body).includes(tokenOf(res.body.link)), "the token is never listed");

    const stored = await TeamInvite.findOne({ workspaceId: owner.user.workspaceId }).lean();
    assert.ok(!JSON.stringify(stored).includes(tokenOf(res.body.link)), "only a hash is stored");
  });

  test("an admin may make member links only; a member may make none", async () => {
    const owner = await signUp(app.baseUrl);
    const a = newcomer();
    const m = newcomer();
    await owner.post("/api/team/members", { ...a, role: "admin" });
    await owner.post("/api/team/members", { ...m, role: "member" });
    const admin = await signIn(app.baseUrl, a);
    const member = await signIn(app.baseUrl, m);

    assert.equal((await admin.post("/api/team/invites", { role: "member" })).status, 201);
    assert.equal((await admin.post("/api/team/invites", { role: "admin" })).status, 403);
    assert.equal((await member.post("/api/team/invites", { role: "member" })).status, 403);
    assert.equal((await member.get("/api/team/invites")).status, 403);
    assert.equal((await owner.post("/api/team/invites", { role: "admin" })).status, 201);
  });

  test("refuses odd settings", async () => {
    const owner = await signUp(app.baseUrl);
    assert.equal((await owner.post("/api/team/invites", { expiresInDays: 365 })).status, 400);
    assert.equal((await owner.post("/api/team/invites", { maxUses: 0 })).status, 400);
    assert.equal((await owner.post("/api/team/invites", { maxUses: 51 })).status, 400);
    assert.equal((await owner.post("/api/team/invites", { role: "owner" })).status, 400);
    assert.equal((await owner.post("/api/team/invites", { email: "nope" })).status, 400);
  });

  test("caps the open links per workspace", async () => {
    const owner = await signUp(app.baseUrl);
    for (let i = 0; i < 25; i++) assert.equal((await owner.post("/api/team/invites", {})).status, 201);
    const over = await owner.post("/api/team/invites", {});
    assert.equal(over.status, 422);
    assert.match(over.body.error.message, /Cancel some/);
  });
});

describe("opening a link", () => {
  test("shows where you would join and as what, without needing an account", async () => {
    const owner = await signUp(app.baseUrl, { name: "Meera Shah", workspaceName: "Acme Studio" });
    const { body } = await owner.post("/api/team/invites", { role: "admin" });
    const seen = await get(`/api/join/${tokenOf(body.link)}`);
    assert.equal(seen.status, 200);
    assert.deepEqual([seen.body.workspace, seen.body.role, seen.body.invitedBy], ["Acme Studio", "admin", "Meera Shah"]);
  });

  test("a made-up link is a plain 404", async () => {
    assert.equal((await get(`/api/join/${"x".repeat(43)}`)).status, 404);
    assert.equal((await post(`/api/join/${"x".repeat(43)}`, newcomer())).status, 404);
  });
});

describe("joining", () => {
  test("makes an account inside the workspace, with the role, signed in at once", async () => {
    const owner = await signUp(app.baseUrl);
    const { body } = await owner.post("/api/team/invites", { role: "member" });
    const person = newcomer();

    const res = await join(body.link, person);
    assert.equal(res.status, 201);
    assert.equal(res.body.user.workspaceId, owner.user.workspaceId, "inside the owner's workspace, not a new one");
    assert.equal(res.body.user.role, "member");
    assert.ok(res.body.accessToken && res.body.refreshToken);

    const stored = await User.findOne({ email: person.email.toLowerCase() }).lean();
    assert.equal(stored.source, "invited");
    assert.equal(String(stored.createdBy), owner.user.id);

    // They are in the team list, and can sign in later with the password they chose.
    const team = (await owner.get("/api/team/members")).body.members;
    assert.ok(team.some((m) => m.email === person.email.toLowerCase() && m.role === "member"));
    assert.equal((await signIn(app.baseUrl, person)).user.workspaceId, owner.user.workspaceId);
  });

  test("an admin link makes an admin", async () => {
    const owner = await signUp(app.baseUrl);
    const { body } = await owner.post("/api/team/invites", { role: "admin" });
    assert.equal((await join(body.link)).body.user.role, "admin");
  });

  test("a single-use link works once", async () => {
    const owner = await signUp(app.baseUrl);
    const { body } = await owner.post("/api/team/invites", {});
    assert.equal((await join(body.link)).status, 201);

    const again = await join(body.link);
    assert.equal(again.status, 410);
    assert.equal(again.body.error.code, "invite_used");
    assert.equal((await get(`/api/join/${tokenOf(body.link)}`)).status, 410);
    assert.equal((await owner.get("/api/team/invites")).body.invites.length, 0, "a used-up link leaves the list");
  });

  test("a link with several uses counts them", async () => {
    const owner = await signUp(app.baseUrl);
    const { body } = await owner.post("/api/team/invites", { maxUses: 2 });
    assert.equal((await join(body.link)).status, 201);
    assert.equal((await owner.get("/api/team/invites")).body.invites[0].uses, 1);
    assert.equal((await join(body.link)).status, 201);
    assert.equal((await join(body.link)).status, 410);
  });

  test("two people opening a single-use link at the same moment: only one gets in", async () => {
    const owner = await signUp(app.baseUrl);
    const { body } = await owner.post("/api/team/invites", {});
    const results = await Promise.all([join(body.link), join(body.link), join(body.link)]);
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(await User.countDocuments({ workspaceId: owner.user.workspaceId }), 2);
  });

  test("an email that already has an account is refused and does not use up the link", async () => {
    const owner = await signUp(app.baseUrl);
    const other = await signUp(app.baseUrl);
    const { body } = await owner.post("/api/team/invites", {});

    const res = await join(body.link, newcomer({ email: other.email }));
    assert.equal(res.status, 409);
    assert.equal((await owner.get("/api/team/invites")).body.invites[0].uses, 0);
    assert.equal((await join(body.link)).status, 201, "the link still works for someone else");
  });

  test("a link for one address works for that address only", async () => {
    const owner = await signUp(app.baseUrl);
    const target = newcomer();
    const { body } = await owner.post("/api/team/invites", { email: target.email, maxUses: 10 });
    assert.equal(body.invite.maxUses, 1, "named links are single use");
    assert.equal((await get(`/api/join/${tokenOf(body.link)}`)).body.email, target.email.toLowerCase());

    assert.equal((await join(body.link, newcomer())).status, 403);
    assert.equal((await join(body.link, { ...target, email: target.email.toUpperCase() })).status, 201);
  });

  test("checks the form", async () => {
    const owner = await signUp(app.baseUrl);
    const { body } = await owner.post("/api/team/invites", { maxUses: 5 });
    assert.equal((await join(body.link, newcomer({ password: "short" }))).status, 400);
    assert.equal((await join(body.link, newcomer({ name: " " }))).status, 400);
    assert.equal((await join(body.link, newcomer({ email: "nope" }))).status, 400);
    assert.equal((await owner.get("/api/team/invites")).body.invites[0].uses, 0);
  });
});

describe("ending a link", () => {
  test("an expired link stops working", async () => {
    const owner = await signUp(app.baseUrl);
    const { body } = await owner.post("/api/team/invites", { maxUses: 5 });
    await TeamInvite.updateOne({ _id: body.invite.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const seen = await get(`/api/join/${tokenOf(body.link)}`);
    assert.equal(seen.status, 410);
    assert.equal(seen.body.error.code, "invite_expired");
    assert.equal((await join(body.link)).status, 410);
    assert.equal((await owner.get("/api/team/invites")).body.invites.length, 0);
  });

  test("a cancelled link stops working, and only its maker or the owner can cancel it", async () => {
    const owner = await signUp(app.baseUrl);
    const a = newcomer();
    const b = newcomer();
    await owner.post("/api/team/members", { ...a, role: "admin" });
    await owner.post("/api/team/members", { ...b, role: "admin" });
    const adminA = await signIn(app.baseUrl, a);
    const adminB = await signIn(app.baseUrl, b);

    const made = await adminA.post("/api/team/invites", { maxUses: 5 });
    assert.equal((await adminB.del(`/api/team/invites/${made.body.invite.id}`)).status, 403, "not another admin's link");
    assert.equal((await adminA.del(`/api/team/invites/${made.body.invite.id}`)).status, 200);

    const seen = await get(`/api/join/${tokenOf(made.body.link)}`);
    assert.equal(seen.status, 410);
    assert.equal(seen.body.error.code, "invite_revoked");
    assert.equal((await join(made.body.link)).status, 410);

    const ownerMade = await adminB.post("/api/team/invites", {});
    assert.equal((await owner.del(`/api/team/invites/${ownerMade.body.invite.id}`)).status, 200, "the owner can cancel any");
  });

  test("another workspace cannot see or cancel your links", async () => {
    const one = await signUp(app.baseUrl);
    const two = await signUp(app.baseUrl);
    const made = await one.post("/api/team/invites", {});
    assert.equal((await two.get("/api/team/invites")).body.invites.length, 0);
    assert.equal((await two.del(`/api/team/invites/${made.body.invite.id}`)).status, 404);
    assert.equal((await get(`/api/join/${tokenOf(made.body.link)}`)).status, 200, "and the link is untouched");
  });

  test("making, using and cancelling a link are in the audit trail", async () => {
    const owner = await signUp(app.baseUrl);
    const made = await owner.post("/api/team/invites", {});
    await join(made.body.link);
    const second = await owner.post("/api/team/invites", {});
    await owner.del(`/api/team/invites/${second.body.invite.id}`);
    const actions = (await AuditLog.find({ workspaceId: owner.user.workspaceId }).lean()).map((l) => l.action);
    for (const wanted of ["team.invite_created", "team.invite_used", "team.invite_revoked"]) assert.ok(actions.includes(wanted), wanted);
  });
});
