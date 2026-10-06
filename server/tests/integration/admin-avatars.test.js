/**
 * The admin's global avatar list: every user's avatars, with their owners.
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { signUp, startTestApp } from "../helpers.js";

let app;
let admin;
let alice;
let bob;

before(async () => {
  app = await startTestApp({ seed: false });
  admin = await signUp(app.baseUrl, { email: "admin@example.com", name: "Admin" });
  alice = await signUp(app.baseUrl, { email: "alice@example.com", name: "Alice" });
  bob = await signUp(app.baseUrl, { email: "bob@example.com", name: "Bob" });

  await alice.post("/api/studio/stock", { providerId: "library", providerAvatarId: "face_f01", name: "Alice's avatar" });
  await alice.post("/api/studio/stock", { providerId: "library", providerAvatarId: "face_f02", name: "Alice second" });
  await bob.post("/api/studio/stock", { providerId: "library", providerAvatarId: "face_m01", name: "Bob's avatar" });
});

after(() => app.stop());

describe("GET /api/admin/avatars", () => {
  test("shows every user's avatars with the owner", async () => {
    const { status, body } = await admin.get("/api/admin/avatars");

    assert.equal(status, 200);
    assert.equal(body.total, 3);
    const byName = Object.fromEntries(body.avatars.map((a) => [a.name, a]));
    assert.equal(byName["Alice's avatar"].owner.email, "alice@example.com");
    assert.equal(byName["Bob's avatar"].owner.email, "bob@example.com");
    assert.equal(byName["Bob's avatar"].calls, 0);
  });

  test("searches by avatar name and by owner", async () => {
    const byName = await admin.get("/api/admin/avatars?q=second");
    assert.deepEqual(byName.body.avatars.map((a) => a.name), ["Alice second"]);

    const byOwner = await admin.get("/api/admin/avatars?q=bob@example");
    assert.deepEqual(byOwner.body.avatars.map((a) => a.name), ["Bob's avatar"]);
  });

  test("filters by status and provider", async () => {
    assert.equal((await admin.get("/api/admin/avatars?status=failed")).body.total, 0);
    assert.equal((await admin.get("/api/admin/avatars?status=ready")).body.total, 3);
    assert.equal((await admin.get("/api/admin/avatars?provider=nope")).body.total, 0);
  });

  test("treats search text literally, not as a pattern", async () => {
    const { status, body } = await admin.get(`/api/admin/avatars?q=${encodeURIComponent(".*")}`);
    assert.equal(status, 200);
    assert.equal(body.total, 0);
  });

  test("is refused to everyone but platform admins", async () => {
    assert.equal((await alice.get("/api/admin/avatars")).status, 403);
    assert.equal((await fetch(`${app.baseUrl}/api/admin/avatars`)).status, 401);
  });
});
