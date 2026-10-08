/**
 * The profile page's API: a person's own details, picture and password, and
 * the workspace's name for the person who owns it.
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { User } from "../../src/models/index.js";
import { signIn, signUp, startTestApp } from "../helpers.js";

let app;

before(async () => {
  app = await startTestApp({ seed: false });
});

after(() => app.stop());

// The first bytes of real files; the server reads them, not the claimed type.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

const putPhoto = (user, bytes, type = "image/png", name = "me.png") => {
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type }), name);
  return fetch(`${app.baseUrl}/api/profile/photo`, { method: "PUT", headers: { authorization: `Bearer ${user.token}` }, body: form }).then(
    async (res) => ({ status: res.status, body: await res.json().catch(() => null) }),
  );
};

describe("reading and editing", () => {
  test("shows who they are, their workspace and how they sign in", async () => {
    const user = await signUp(app.baseUrl, { name: "Meera Shah" });
    const { status, body } = await user.get("/api/profile");
    assert.equal(status, 200);
    assert.equal(body.profile.name, "Meera Shah");
    assert.equal(body.profile.email, user.email);
    assert.equal(body.profile.role, "owner");
    assert.equal(body.profile.hasPassword, true);
    assert.equal(body.profile.googleLinked, false);
    assert.ok(body.profile.workspace.name);
    assert.ok(!JSON.stringify(body).toLowerCase().includes("passwordhash"));
  });

  test("saves name, title, phone and time zone", async () => {
    const user = await signUp(app.baseUrl);
    const res = await user.patch("/api/profile", { name: "Meera S", title: "Founder", phone: "+91 98765 43210", timezone: "Asia/Kolkata" });
    assert.equal(res.status, 200);
    assert.deepEqual(
      [res.body.profile.name, res.body.profile.title, res.body.profile.phone, res.body.profile.timezone],
      ["Meera S", "Founder", "+91 98765 43210", "Asia/Kolkata"],
    );
    assert.equal((await user.get("/api/profile")).body.profile.title, "Founder");
  });

  test("refuses an empty name, a made-up time zone, letters in a phone number and unknown fields", async () => {
    const user = await signUp(app.baseUrl);
    assert.equal((await user.patch("/api/profile", { name: "  " })).status, 400);
    assert.equal((await user.patch("/api/profile", { timezone: "Mars/Olympus" })).status, 422);
    assert.equal((await user.patch("/api/profile", { phone: "call me" })).status, 400);
    assert.equal((await user.patch("/api/profile", { role: "owner", email: "x@y.com" })).status, 400);
  });

  test("the owner renames the workspace; a member cannot", async () => {
    const owner = await signUp(app.baseUrl);
    assert.equal((await owner.patch("/api/profile", { workspaceName: "Acme Studio" })).body.profile.workspace.name, "Acme Studio");

    const input = { name: "Sam", email: `sam-${Math.random().toString(36).slice(2, 8)}@example.com`, password: "a-long-password-1" };
    await owner.post("/api/team/members", { ...input, role: "member" });
    const member = await signIn(app.baseUrl, input);
    assert.equal((await member.patch("/api/profile", { workspaceName: "Mine now" })).status, 403);
    assert.equal((await member.patch("/api/profile", { title: "Support" })).status, 200);
  });

  test("needs a sign-in", async () => {
    assert.equal((await fetch(`${app.baseUrl}/api/profile`)).status, 401);
  });
});

describe("the picture", () => {
  test("is set, replaced and removed", async () => {
    const user = await signUp(app.baseUrl);

    const first = await putPhoto(user, PNG);
    assert.equal(first.status, 200);
    const url = first.body.profile.photoUrl;
    assert.match(url, /\/profile\/.+\.png$/);

    const second = await putPhoto(user, JPEG, "image/jpeg", "me.jpg");
    assert.match(second.body.profile.photoUrl, /\.jpg$/);
    assert.notEqual(second.body.profile.photoUrl, url);

    const gone = await user.del("/api/profile/photo");
    assert.equal(gone.body.profile.photoUrl, null);
    const stored = await User.findById(user.user.id).lean();
    assert.equal(stored.photoKey, undefined);
  });

  test("a file that only claims to be a picture is refused", async () => {
    const user = await signUp(app.baseUrl);
    const res = await putPhoto(user, Buffer.from("<script>alert(1)</script>".padEnd(64)), "image/png", "evil.png");
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /JPG, PNG or WebP/);
  });

  test("a picture over 5 MB is refused", async () => {
    const user = await signUp(app.baseUrl);
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    assert.ok([413, 422].includes((await putPhoto(user, big)).status));
  });

  test("shows on the sign-in response so the sidebar has it", async () => {
    const user = await signUp(app.baseUrl);
    await putPhoto(user, PNG);
    const again = await signIn(app.baseUrl, { email: user.email, password: user.password });
    assert.match(again.user.photoUrl, /profile/);
  });
});

describe("the password", () => {
  test("needs the current one, then changes it and signs other devices out", async () => {
    const user = await signUp(app.baseUrl);
    const wrong = await user.post("/api/profile/password", { currentPassword: "not-my-password", newPassword: "a-new-long-password" });
    assert.equal(wrong.status, 422);
    assert.match(wrong.body.error.message, /current password/i);
    assert.equal((await user.post("/api/profile/password", { newPassword: "a-new-long-password" })).status, 422);
    assert.equal((await user.post("/api/profile/password", { currentPassword: user.password, newPassword: "short" })).status, 400);
    assert.equal((await user.post("/api/profile/password", { currentPassword: user.password, newPassword: user.password })).status, 422);

    const ok = await user.post("/api/profile/password", { currentPassword: user.password, newPassword: "a-new-long-password" });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.accessToken && ok.body.refreshToken, "this device is handed fresh tokens so it stays in");

    const stale = await fetch(`${app.baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: user.refreshToken }),
    });
    assert.equal(stale.status, 401, "other devices are signed out");
    const fresh = await fetch(`${app.baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: ok.body.refreshToken }),
    });
    assert.equal(fresh.status, 200);

    await assert.rejects(signIn(app.baseUrl, { email: user.email, password: user.password }));
    assert.equal((await signIn(app.baseUrl, { email: user.email, password: "a-new-long-password" })).user.id, user.user.id);
  });

  test("an account with no password (Google) can set its first without one", async () => {
    const user = await signUp(app.baseUrl);
    await User.updateOne({ _id: user.user.id }, { $unset: { passwordHash: 1 }, $set: { googleId: "g-123" } });
    const profile = (await user.get("/api/profile")).body.profile;
    assert.equal(profile.hasPassword, false);
    assert.equal(profile.googleLinked, true);

    assert.equal((await user.post("/api/profile/password", { newPassword: "my-first-password-1" })).status, 200);
    assert.equal((await signIn(app.baseUrl, { email: user.email, password: "my-first-password-1" })).user.id, user.user.id);
  });
});
