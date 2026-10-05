/**
 * "Continue with Google": the ID token is verified against Google's published
 * keys. Here the keys are a pair made for the test and "published" by stubbing
 * the one fetch to Google, so the real verification code runs end to end.
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { signIn, signUp, startTestApp } from "../helpers.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-kid";

let app;
const realFetch = globalThis.fetch;

before(async () => {
  globalThis.fetch = (url, init) =>
    String(url) === "https://www.googleapis.com/oauth2/v3/certs"
      ? Promise.resolve(
          new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] }), {
            headers: { "content-type": "application/json", "cache-control": "public, max-age=600" },
          }),
        )
      : realFetch(url, init);
  app = await startTestApp();
});

after(async () => {
  globalThis.fetch = realFetch;
  await app.stop();
});

function googleToken(claims = {}, { key = privateKey, audience = CLIENT_ID } = {}) {
  return jwt.sign(
    { email_verified: true, name: "Gee User", ...claims },
    key,
    { algorithm: "RS256", keyid: KID, audience, issuer: "https://accounts.google.com", expiresIn: "5m" },
  );
}

const post = (credential) =>
  realFetch(`${app.baseUrl}/api/auth/google`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential }),
  });

describe("google sign-in", () => {
  test("the sign-in page is told the client id", async () => {
    const body = await (await realFetch(`${app.baseUrl}/api/auth/config`)).json();
    assert.equal(body.googleClientId, CLIENT_ID);
  });

  test("first use creates the account and workspace; second use signs in", async () => {
    const token = googleToken({ sub: "g-1001", email: "New.Person@Gmail.com" });

    const first = await post(token);
    assert.equal(first.status, 200);
    const created = await first.json();
    assert.ok(created.accessToken && created.refreshToken);
    assert.equal(created.user.email, "new.person@gmail.com");
    assert.ok(created.user.workspaceId);

    const again = await (await post(token)).json();
    assert.equal(again.user.id, created.user.id);

    // A Google-only account has no password to guess.
    const pw = await realFetch(`${app.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new.person@gmail.com", password: "anything-at-all" }),
    });
    assert.equal(pw.status, 401);
  });

  test("an existing email/password account is linked, not duplicated", async () => {
    const account = await signUp(app.baseUrl);
    const res = await post(googleToken({ sub: "g-2002", email: account.email }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).user.id, account.user.id);
    // The password still works too.
    await signIn(app.baseUrl, { email: account.email, password: account.password });
  });

  test("refuses a token signed by anyone but Google", async () => {
    const { privateKey: other } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const res = await post(googleToken({ sub: "g-3", email: "x@gmail.com" }, { key: other }));
    assert.equal(res.status, 401);
  });

  test("refuses a token minted for another site", async () => {
    const res = await post(googleToken({ sub: "g-4", email: "y@gmail.com" }, { audience: "someone-else" }));
    assert.equal(res.status, 401);
  });

  test("refuses an unverified email", async () => {
    const res = await post(googleToken({ sub: "g-5", email: "z@gmail.com", email_verified: false }));
    assert.equal(res.status, 401);
  });

  test("will not move an email to a second Google account", async () => {
    await post(googleToken({ sub: "g-6", email: "owner@gmail.com" }));
    const res = await post(googleToken({ sub: "g-7", email: "owner@gmail.com" }));
    assert.equal(res.status, 401);
  });
});
