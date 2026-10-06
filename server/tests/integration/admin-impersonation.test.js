/**
 * "Act as user": an admin signing in as someone else - what it allows, what it
 * refuses, and what it leaves behind in the audit trail.
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { AuditLog } from "../../src/models/index.js";
import { env } from "../../src/config/env.js";
import { signUp, startTestApp } from "../helpers.js";

let app;
let admin;
let alice;
let otherAdmin;

before(async () => {
  app = await startTestApp({ seed: false });
  admin = await signUp(app.baseUrl, { email: "admin@example.com", name: "Admin" });
  alice = await signUp(app.baseUrl, { email: "alice@example.com", name: "Alice" });
  otherAdmin = await signUp(app.baseUrl, { email: "boss@example.com", name: "Boss" });
  await admin.patch(`/api/admin/users/${otherAdmin.user.id}`, { role: "admin" });

  await alice.post("/api/studio/stock", { providerId: "library", providerAvatarId: "face_f01", name: "Alice's avatar" });
});

after(() => app.stop());

/** A client signed in as Alice through the admin's impersonation token. */
async function actAsAlice() {
  const { status, body } = await admin.post(`/api/admin/users/${alice.user.id}/impersonate`);
  assert.equal(status, 200);
  const call = (method, path, data) =>
    fetch(`${app.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${body.accessToken}`, ...(data ? { "content-type": "application/json" } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
  return { ...body, get: (p) => call("GET", p), post: (p, d) => call("POST", p, d), patch: (p, d) => call("PATCH", p, d), del: (p) => call("DELETE", p) };
}

describe("starting", () => {
  test("gives the admin Alice's identity, for an hour, with no refresh token", async () => {
    const as = await actAsAlice();

    assert.equal(as.user.email, "alice@example.com");
    assert.equal(as.refreshToken, undefined);
    const claims = jwt.decode(as.accessToken);
    assert.equal(claims.sub, alice.user.id);
    assert.equal(claims.imp, admin.user.id);
    assert.ok(claims.exp - claims.iat <= 3600);
  });

  test("is for platform admins only", async () => {
    const res = await alice.post(`/api/admin/users/${admin.user.id}/impersonate`);
    assert.equal(res.status, 403);
  });

  test("refuses to act as another admin, or as yourself", async () => {
    assert.equal((await admin.post(`/api/admin/users/${otherAdmin.user.id}/impersonate`)).status, 403);
    assert.equal((await admin.post(`/api/admin/users/${admin.user.id}/impersonate`)).status, 422);
  });

  test("404s for a user that does not exist", async () => {
    assert.equal((await admin.post("/api/admin/users/aaaaaaaaaaaaaaaaaaaaaaaa/impersonate")).status, 404);
  });
});

describe("while acting as a user", () => {
  test("sees that user's data, and not the admin's", async () => {
    const as = await actAsAlice();
    const { body } = await as.get("/api/avatars");
    assert.deepEqual(body.avatars.map((a) => a.name), ["Alice's avatar"]);
  });

  test("can change their data", async () => {
    const as = await actAsAlice();
    const { body: list } = await as.get("/api/avatars");
    const id = list.avatars[0]._id;

    const res = await as.patch(`/api/avatars/${id}`, { name: "Renamed by admin" });
    assert.equal(res.status, 200);
    assert.equal((await alice.get(`/api/avatars/${id}`)).body.avatar.name, "Renamed by admin");
  });

  test("does not carry admin rights", async () => {
    const as = await actAsAlice();
    assert.equal((await as.get("/api/admin/stats")).status, 403);
    assert.deepEqual((await as.get("/api/admin/access")).body?.admin ?? false, false);
  });

  test("cannot mint lasting credentials or sign the person out", async () => {
    const as = await actAsAlice();

    const key = await as.post("/api/api-keys", { name: "backdoor" });
    assert.equal(key.status, 403);
    assert.equal(key.body.error.code, "impersonation_restricted");

    assert.equal((await as.get("/api/api-keys")).status, 403);
    assert.equal((await as.post("/api/oauth/authorize", {})).status, 403);
    assert.equal((await as.post("/api/auth/logout")).status, 403);

    // Alice's own session is untouched.
    assert.equal((await alice.get("/api/avatars")).status, 200);
    assert.equal((await alice.get("/api/api-keys")).body.keys.length, 0);
  });

  test("works on a blocked account, which is when it is most needed", async () => {
    const blockedUser = await signUp(app.baseUrl, { email: "blocked@example.com", name: "Blocked" });
    await admin.post(`/api/admin/users/${blockedUser.user.id}/block`, { reason: "test" });
    assert.equal((await blockedUser.get("/api/avatars")).status, 403);

    const { body } = await admin.post(`/api/admin/users/${blockedUser.user.id}/impersonate`);
    assert.equal(body.blocked, true);
    const res = await fetch(`${app.baseUrl}/api/avatars`, { headers: { authorization: `Bearer ${body.accessToken}` } });
    assert.equal(res.status, 200);
  });
});

describe("the audit trail", () => {
  test("records start, each change and end under the user's workspace, naming the admin", async () => {
    const before = await AuditLog.countDocuments({ workspaceId: alice.user.workspaceId });
    const as = await actAsAlice();
    const { body: list } = await as.get("/api/avatars");
    await as.patch(`/api/avatars/${list.avatars[0]._id}`, { name: "Audited rename" });
    await as.post("/api/impersonation/end");
    // The change row is written when the response finishes.
    await new Promise((r) => setTimeout(r, 100));

    const rows = await AuditLog.find({ workspaceId: alice.user.workspaceId }).sort({ createdAt: 1 }).lean();
    const added = rows.slice(before).map((r) => r.action);
    assert.deepEqual(added, ["impersonation.start", "impersonation.change", "impersonation.end"]);
    for (const row of rows.slice(before)) assert.equal(String(row.actorId), admin.user.id);
    const change = rows.at(-2);
    assert.equal(change.meta.method, "PATCH");
    assert.match(change.meta.path, /^\/api\/avatars\//);
  });

  test("a read leaves no change row, and a refused change none either", async () => {
    const before = await AuditLog.countDocuments({ action: "impersonation.change" });
    const as = await actAsAlice();
    await as.get("/api/avatars");
    await as.post("/api/api-keys", { name: "nope" });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(await AuditLog.countDocuments({ action: "impersonation.change" }), before);
  });
});

describe("expiry", () => {
  test("an expired impersonation token is rejected", async () => {
    const expired = jwt.sign(
      { sub: alice.user.id, wsp: alice.user.workspaceId, role: "owner", imp: admin.user.id },
      env.jwt.accessSecret,
      { expiresIn: -10 },
    );
    const res = await fetch(`${app.baseUrl}/api/avatars`, { headers: { authorization: `Bearer ${expired}` } });
    assert.equal(res.status, 401);
  });
});
