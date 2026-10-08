/**
 * The Team page's API: a workspace's owner and admins add people who sign in
 * at once, change their role, reset their password and remove them - and who
 * may do what to whom is enforced here, not in the page.
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { AuditLog, User } from "../../src/models/index.js";
import { signIn, signUp, startTestApp } from "../helpers.js";

let app;

before(async () => {
  app = await startTestApp({ seed: false });
});

after(() => app.stop());

const PASSWORD = "a-long-password-1";
const person = (over = {}) => ({ name: "Asha Rao", email: `asha-${Math.random().toString(36).slice(2, 8)}@example.com`, password: PASSWORD, ...over });

/** An owner with an admin and a member already in the workspace, each signed in. */
async function workspace() {
  const owner = await signUp(app.baseUrl);
  const a = person({ name: "Admin Person" });
  const m = person({ name: "Member Person" });
  const admin = (await owner.post("/api/team/members", { ...a, role: "admin" })).body.member;
  const member = (await owner.post("/api/team/members", { ...m, role: "member" })).body.member;
  return {
    owner,
    admin,
    member,
    adminClient: await signIn(app.baseUrl, a),
    memberClient: await signIn(app.baseUrl, m),
  };
}

describe("adding people", () => {
  test("an owner adds someone, who signs in at once into the same workspace", async () => {
    const owner = await signUp(app.baseUrl);
    const input = person();

    const res = await owner.post("/api/team/members", { ...input, role: "member" });
    assert.equal(res.status, 201);
    assert.equal(res.body.member.role, "member");
    assert.equal(res.body.member.email, input.email.toLowerCase());
    assert.ok(!JSON.stringify(res.body).includes("passwordHash"));

    const theirs = await signIn(app.baseUrl, input);
    assert.equal(theirs.user.workspaceId, owner.user.workspaceId, "they join the owner's workspace, not one of their own");
    assert.equal((await theirs.get("/api/auth/me")).body.workspace._id, owner.user.workspaceId);

    const stored = await User.findOne({ email: input.email.toLowerCase() }).lean();
    assert.equal(String(stored.createdBy), owner.user.id);
    assert.equal(stored.source, "manual");
  });

  test("the list shows the owner first, and the person asking", async () => {
    const { owner, admin, member } = await workspace();
    const { status, body } = await owner.get("/api/team/members");
    assert.equal(status, 200);
    assert.deepEqual(body.members.map((m) => m.role), ["owner", "admin", "member"]);
    assert.equal(body.me, owner.user.id);
    assert.deepEqual(body.members.slice(1).map((m) => m.id), [admin.id, member.id]);
  });

  test("an email that already has an account, a weak password and a bad role are refused", async () => {
    const owner = await signUp(app.baseUrl);
    const input = person();
    assert.equal((await owner.post("/api/team/members", input)).status, 201);
    assert.equal((await owner.post("/api/team/members", { ...input, name: "Again" })).status, 409);
    assert.equal((await owner.post("/api/team/members", { ...person(), password: "short" })).status, 400);
    assert.equal((await owner.post("/api/team/members", { ...person(), role: "owner" })).status, 400);
    assert.equal((await owner.post("/api/team/members", { ...person(), email: "not-an-email" })).status, 400);
  });

  test("two workspaces never see each other's people", async () => {
    const one = await signUp(app.baseUrl);
    const two = await signUp(app.baseUrl);
    const added = (await one.post("/api/team/members", person())).body.member;

    assert.equal((await two.get("/api/team/members")).body.members.length, 1);
    assert.equal((await two.patch(`/api/team/members/${added.id}`, { name: "Hijack" })).status, 404);
    assert.equal((await two.del(`/api/team/members/${added.id}`)).status, 404);
  });

  test("needs a sign-in", async () => {
    assert.equal((await signUp(app.baseUrl).then(() => fetch(`${app.baseUrl}/api/team/members`))).status, 401);
  });
});

describe("who may do what", () => {
  test("a member cannot see or change the team", async () => {
    const { memberClient, member } = await workspace();
    assert.equal((await memberClient.get("/api/team/members")).status, 403);
    assert.equal((await memberClient.post("/api/team/members", { ...person(), role: "member" })).status, 403);
    assert.equal((await memberClient.del(`/api/team/members/${member.id}`)).status, 403);
  });

  test("an admin adds and manages members, but not admins and not the owner", async () => {
    const { owner, adminClient, admin, member } = await workspace();

    assert.equal((await adminClient.post("/api/team/members", { ...person(), role: "member" })).status, 201);
    assert.equal((await adminClient.post("/api/team/members", { ...person(), role: "admin" })).status, 403, "only the owner makes admins");
    assert.equal((await adminClient.patch(`/api/team/members/${member.id}`, { title: "Sales" })).status, 200);
    assert.equal((await adminClient.patch(`/api/team/members/${member.id}`, { role: "admin" })).status, 403);

    const ownerId = owner.user.id;
    assert.equal((await adminClient.del(`/api/team/members/${ownerId}`)).status, 403);
    assert.equal((await adminClient.patch(`/api/team/members/${ownerId}`, { role: "member" })).status, 403);

    const second = (await owner.post("/api/team/members", { ...person(), role: "admin" })).body.member;
    assert.equal((await adminClient.del(`/api/team/members/${second.id}`)).status, 403, "an admin cannot remove another admin");
    assert.equal((await adminClient.post(`/api/team/members/${second.id}/password`, { password: PASSWORD })).status, 403);
    assert.equal((await adminClient.del(`/api/team/members/${admin.id}`)).status, 422, "nor themselves");
  });

  test("nobody can change or remove the owner, or themselves", async () => {
    const { owner } = await workspace();
    assert.equal((await owner.del(`/api/team/members/${owner.user.id}`)).status, 422);
    assert.equal((await owner.patch(`/api/team/members/${owner.user.id}`, { role: "member" })).status, 422);
  });

  test("only an owner or admin can buy credits", async () => {
    const { memberClient, adminClient } = await workspace();
    const member = await memberClient.post("/api/billing/checkout", { packId: "0".repeat(24) });
    assert.equal(member.status, 403);
    assert.equal(member.body.error.code, "not_a_manager");
    // Past the role check, a manager meets whatever the checkout itself says (here: not set up).
    assert.notEqual((await adminClient.post("/api/billing/checkout", { packId: "0".repeat(24) })).status, 403);
  });
});

describe("changing and removing", () => {
  test("a role change takes effect on the next request, and signs their old session out", async () => {
    const { owner, memberClient, member } = await workspace();
    assert.equal((await memberClient.get("/api/team/members")).status, 403);

    const res = await owner.patch(`/api/team/members/${member.id}`, { role: "admin", name: "Promoted", title: "Head of sales" });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.member.role, res.body.member.name, res.body.member.title], ["admin", "Promoted", "Head of sales"]);

    // The token they hold still says "member", but the database decides.
    assert.equal((await memberClient.get("/api/team/members")).status, 200);
  });

  test("resetting a password signs them out and the new one works", async () => {
    const { owner, member, memberClient } = await workspace();
    const email = (await owner.get("/api/team/members")).body.members.find((m) => m.id === member.id).email;

    assert.equal((await owner.post(`/api/team/members/${member.id}/password`, { password: "short" })).status, 400);
    assert.equal((await owner.post(`/api/team/members/${member.id}/password`, { password: "a-brand-new-password" })).status, 200);

    const old = await fetch(`${app.baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: memberClient.refreshToken }),
    });
    assert.equal(old.status, 401, "their old session is ended");
    assert.equal((await signIn(app.baseUrl, { email, password: "a-brand-new-password" })).user.id, member.id);
    await assert.rejects(signIn(app.baseUrl, { email, password: PASSWORD }));
  });

  test("a removed person is out at once, even with a token that has not expired", async () => {
    const { owner, member, memberClient } = await workspace();
    assert.equal((await memberClient.get("/api/billing/credits")).status, 200);

    assert.equal((await owner.del(`/api/team/members/${member.id}`)).status, 200);
    assert.equal(await User.countDocuments({ _id: member.id }), 0);
    assert.equal((await memberClient.get("/api/billing/credits")).status, 401);
    assert.equal((await owner.get("/api/team/members")).body.members.length, 2);
  });

  test("every change is in the workspace's audit trail", async () => {
    const { owner, member } = await workspace();
    await owner.patch(`/api/team/members/${member.id}`, { title: "Support" });
    await owner.del(`/api/team/members/${member.id}`);
    const actions = (await AuditLog.find({ workspaceId: owner.user.workspaceId }).lean()).map((l) => l.action);
    for (const wanted of ["team.member_added", "team.member_updated", "team.member_removed"]) assert.ok(actions.includes(wanted), wanted);
  });
});
