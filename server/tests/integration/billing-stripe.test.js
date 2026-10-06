/**
 * Buying a credit pack with Stripe: starting a checkout, and the signed webhook
 * that credits it. Stripe's API is replaced by a stand-in so nothing is charged;
 * webhooks are signed here with real HMACs, the way Stripe signs them.
 */
import "../setup-env.js";
import test, { after, afterEach, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { env } from "../../src/config/env.js";
import { CreditPack, CreditTransaction, ErrorLog } from "../../src/models/index.js";
import { creditService } from "../../src/modules/billing/credit.service.js";
import { verifyWebhook } from "../../src/integrations/payments/stripe.js";
import { signUp, startTestApp } from "../helpers.js";

let app;
let pack;
const realFetch = globalThis.fetch;

const SECRET = "whsec_test_secret";
const calls = [];
let stripe;

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

before(async () => {
  app = await startTestApp({ seed: false });
  pack = await CreditPack.create({ name: "Starter", credits: 500, priceCents: 1900, currency: "usd" });
  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (address.startsWith("https://api.stripe.com")) {
      calls.push({ url: address, method: init?.method, auth: init?.headers?.Authorization, form: new URLSearchParams(String(init?.body)) });
      return stripe(address, init);
    }
    return realFetch(url, init);
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await app.stop();
});

afterEach(() => {
  calls.length = 0;
  env.stripe.secretKey = "";
  env.stripe.webhookSecret = "";
});

const checkout = (user, packId = pack._id) => user.post("/api/billing/checkout", { packId: String(packId) });
const configure = () => {
  env.stripe.secretKey = "sk_test_123";
  // Selling needs the webhook secret too: without it a payment could not be credited.
  env.stripe.webhookSecret = "whsec_for_checkout_tests";
  stripe = () => reply({ id: "cs_test_1", url: "https://checkout.stripe.test/pay/cs_test_1" });
};

describe("starting a checkout", () => {
  test("needs a signed-in person", async () => {
    configure();
    const res = await fetch(`${app.baseUrl}/api/billing/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ packId: String(pack._id) }),
    });
    assert.equal(res.status, 401);
  });

  test("will not sell with only the secret key, since the payment could never be credited", async () => {
    env.stripe.secretKey = "sk_test_123";
    stripe = () => reply({ id: "cs_test_1", url: "https://checkout.stripe.test/pay/cs_test_1" });
    const user = await signUp(app.baseUrl);

    assert.equal((await checkout(user)).status, 503);
    assert.equal(calls.length, 0, "Stripe was never asked to take a payment");
    assert.equal((await user.get("/api/billing/credits")).body.purchasable, false);

    env.stripe.webhookSecret = "whsec_now_set";
    assert.equal((await user.get("/api/billing/credits")).body.purchasable, true);
  });

  test("says so when Stripe is not set up, without calling it", async () => {
    const user = await signUp(app.baseUrl);
    const { status, body } = await checkout(user);
    assert.equal(status, 503);
    assert.equal(body.error.message, "Buying credits is not set up yet.");
    assert.equal(calls.length, 0);
  });

  test("refuses an unknown, inactive or malformed pack", async () => {
    configure();
    const user = await signUp(app.baseUrl);
    const inactive = await CreditPack.create({ name: "Old", credits: 10, priceCents: 100, active: false });

    assert.equal((await checkout(user, "aaaaaaaaaaaaaaaaaaaaaaaa")).status, 404);
    assert.equal((await checkout(user, inactive._id)).status, 422);
    assert.equal((await checkout(user, "nope")).status, 400);
    assert.equal(calls.length, 0);
  });

  test("sends Stripe the pack, who is buying and where to come back to, and returns the page", async () => {
    configure();
    const user = await signUp(app.baseUrl);

    const { status, body } = await checkout(user);

    assert.equal(status, 200);
    assert.deepEqual(body, { url: "https://checkout.stripe.test/pay/cs_test_1" });
    const sent = calls[0];
    assert.equal(sent.url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(sent.method, "POST");
    assert.equal(sent.auth, "Bearer sk_test_123");

    const expected = {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "1900",
      "line_items[0][price_data][product_data][name]": "500 credits - Starter",
      client_reference_id: user.user.workspaceId,
      customer_email: user.email,
      success_url: `${env.clientOrigin}/credits?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.clientOrigin}/credits?purchase=cancelled`,
    };
    for (const prefix of ["metadata", "payment_intent_data[metadata]"]) {
      Object.assign(expected, {
        [`${prefix}[workspaceId]`]: user.user.workspaceId,
        [`${prefix}[userId]`]: user.user.id,
        [`${prefix}[packId]`]: String(pack._id),
        [`${prefix}[credits]`]: "500",
        [`${prefix}[packName]`]: "Starter",
      });
    }
    assert.deepEqual(Object.fromEntries(sent.form), expected);
  });

  describe("what Stripe's failures become", () => {
    const cases = [
      ["a rejected key", 401, { error: { message: "Invalid API Key provided: sk_test_***" } }, 503, /not set up correctly/i, true],
      ["a refused request", 400, { error: { message: "Invalid currency: xyz" } }, 502, /Invalid currency/, true],
      ["a server fault", 500, null, 502, /could not start that purchase/i, true],
      ["being busy", 429, { error: { message: "rate limit" } }, 429, /busy/i, false],
    ];

    for (const [name, httpStatus, answer, status, message, logged] of cases) {
      test(`${name} -> ${status}${logged ? ", and the admin's error log" : ""}`, async () => {
        configure();
        stripe = () => reply(answer, httpStatus);
        const user = await signUp(app.baseUrl);
        const before = await ErrorLog.countDocuments({ errorType: "PAYMENT_CHECKOUT" });

        const res = await checkout(user);

        assert.equal(res.status, status);
        assert.match(res.body.error.message, message);
        assert.ok(!JSON.stringify(res.body).includes("sk_test_123"), "key leaked");
        await new Promise((r) => setTimeout(r, 50));
        assert.equal((await ErrorLog.countDocuments({ errorType: "PAYMENT_CHECKOUT" })) - before, logged ? 1 : 0);
      });
    }

    test("an unreachable Stripe -> 502", async () => {
      configure();
      stripe = () => {
        throw new TypeError("fetch failed");
      };
      const res = await checkout(await signUp(app.baseUrl));
      assert.equal(res.status, 502);
      assert.match(res.body.error.message, /could not reach/i);
    });
  });

  test("is refused while an admin is acting as the user", async () => {
    configure();
    const admin = await signUp(app.baseUrl, { email: "admin@example.com", name: "Admin" });
    const alice = await signUp(app.baseUrl);
    const { body: imp } = await admin.post(`/api/admin/users/${alice.user.id}/impersonate`);

    const res = await fetch(`${app.baseUrl}/api/billing/checkout`, {
      method: "POST",
      headers: { authorization: `Bearer ${imp.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ packId: String(pack._id) }),
    });

    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, "impersonation_restricted");
    assert.equal(calls.length, 0);
  });
});

// ---- the webhook ------------------------------------------------------------------

const sign = (payload, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) =>
  `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

const post = (payload, signature) =>
  fetch(`${app.baseUrl}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(signature ? { "stripe-signature": signature } : {}) },
    body: payload,
  });

const session = (workspaceId, over = {}) => ({
  id: `cs_${crypto.randomUUID()}`,
  object: "checkout.session",
  payment_status: "paid",
  client_reference_id: workspaceId,
  payment_intent: "pi_1",
  amount_total: 1900,
  currency: "usd",
  metadata: { workspaceId, userId: "u1", packId: String(pack._id), credits: "500", packName: "Starter" },
  ...over,
});

const event = (type, object) => JSON.stringify({ id: `evt_${crypto.randomUUID()}`, type, data: { object } });

/** Sends a correctly signed event. */
const deliver = (type, object) => {
  env.stripe.webhookSecret = SECRET;
  const payload = event(type, object);
  return post(payload, sign(payload));
};

const purchases = (sessionId) => CreditTransaction.find({ kind: "purchase", ref: `stripe:${sessionId}` }).lean();

describe("the webhook's signature check", () => {
  // Built per test: the pack only exists once the app has started.
  const makeBody = () => event("checkout.session.completed", session("aaaaaaaaaaaaaaaaaaaaaaaa"));
  let body;
  beforeEach(() => {
    body = makeBody();
  });

  test("refuses everything when no secret is configured", async () => {
    assert.equal((await post(body, sign(body))).status, 503);
  });

  test("refuses a missing, wrong or malformed signature", async () => {
    env.stripe.webhookSecret = SECRET;
    assert.equal((await post(body)).status, 400);
    assert.equal((await post(body, sign(body, { secret: "whsec_other" }))).status, 400);
    assert.equal((await post(body, "garbage")).status, 400);
    assert.equal((await post(`${body} `, sign(body))).status, 400, "a changed body no longer matches");
  });

  test("refuses a stale timestamp even when the signature is genuine", async () => {
    env.stripe.webhookSecret = SECRET;
    const old = Math.floor(Date.now() / 1000) - 10 * 60;
    assert.equal((await post(body, sign(body, { t: old }))).status, 400);
  });

  test("a bad request credits nothing", async () => {
    env.stripe.webhookSecret = SECRET;
    const user = await signUp(app.baseUrl);
    const s = session(user.user.workspaceId);
    const payload = event("checkout.session.completed", s);
    await post(payload, sign(payload, { secret: "whsec_other" }));
    assert.equal((await purchases(s.id)).length, 0);
  });
});

describe("crediting a purchase", () => {
  test("credits the pack once, however many times Stripe delivers it", async () => {
    const user = await signUp(app.baseUrl);
    const workspaceId = user.user.workspaceId;
    await creditService.ensureGrants(workspaceId);
    const start = await creditService.getBalance(workspaceId);
    const s = session(workspaceId);

    const first = await deliver("checkout.session.completed", s);
    const second = await deliver("checkout.session.completed", s);
    // The delayed-payment event for the same session must not credit again either.
    const third = await deliver("checkout.session.async_payment_succeeded", s);

    assert.deepEqual([first.status, second.status, third.status], [200, 200, 200]);
    assert.equal(await creditService.getBalance(workspaceId), start + 500);
    const rows = await purchases(s.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].credits, 500);
    assert.equal(rows[0].note, "Credit pack: Starter");
    assert.equal(rows[0].meta.paymentIntent, "pi_1");
    assert.equal(rows[0].meta.packId, String(pack._id));
  });

  test("ignores a session that is not paid", async () => {
    const user = await signUp(app.baseUrl);
    const s = session(user.user.workspaceId, { payment_status: "unpaid" });
    assert.equal((await deliver("checkout.session.completed", s)).status, 200);
    assert.equal((await purchases(s.id)).length, 0);
  });

  test("ignores a session whose reference does not match its metadata", async () => {
    const user = await signUp(app.baseUrl);
    const other = await signUp(app.baseUrl);
    const s = session(user.user.workspaceId, { client_reference_id: other.user.workspaceId });
    assert.equal((await deliver("checkout.session.completed", s)).status, 200);
    assert.equal((await purchases(s.id)).length, 0);
  });

  test("ignores a workspace that does not exist, and credits that make no sense", async () => {
    const ghost = "bbbbbbbbbbbbbbbbbbbbbbbb";
    const a = session(ghost);
    assert.equal((await deliver("checkout.session.completed", a)).status, 200);

    const user = await signUp(app.baseUrl);
    for (const credits of ["0", "-5", "2.5", "lots", undefined]) {
      const s = session(user.user.workspaceId);
      s.metadata.credits = credits;
      assert.equal((await deliver("checkout.session.completed", s)).status, 200);
      assert.equal((await purchases(s.id)).length, 0);
    }
    assert.equal((await purchases(a.id)).length, 0);
  });

  test("answers 200 for events it does not use", async () => {
    assert.equal((await deliver("customer.created", { id: "cus_1" })).status, 200);
  });

  test("a refund is recorded for an admin and takes nothing away", async () => {
    const user = await signUp(app.baseUrl);
    const workspaceId = user.user.workspaceId;
    await creditService.ensureGrants(workspaceId);
    const s = session(workspaceId);
    await deliver("checkout.session.completed", s);
    const balance = await creditService.getBalance(workspaceId);
    const before = await ErrorLog.countDocuments({ errorType: "PAYMENT_REFUND" });

    assert.equal((await deliver("charge.refunded", { id: "ch_1", object: "charge", payment_intent: "pi_1", amount: 1900 })).status, 200);
    assert.equal((await deliver("charge.dispute.created", { id: "dp_1", object: "dispute", charge: "ch_2", payment_intent: "pi_2" })).status, 200);

    const rows = await ErrorLog.find({ errorType: "PAYMENT_REFUND" }).sort({ createdAt: 1 }).lean();
    assert.equal(rows.length - before, 2);
    assert.equal(rows.at(-2).severity, "WARNING");
    assert.equal(rows.at(-2).details.chargeId, "ch_1");
    assert.equal(rows.at(-1).details.chargeId, "ch_2");
    assert.equal(await creditService.getBalance(workspaceId), balance);
  });
});

describe("verifyWebhook", () => {
  const payload = Buffer.from(JSON.stringify({ id: "evt_1", type: "x" }));
  const NOW = 1_700_000_000_000;
  const hmac = (secret, t, body = payload) =>
    crypto.createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex");

  test("returns the event for a good signature", () => {
    const header = `t=1700000000,v1=${hmac("whsec_a", 1700000000)}`;
    assert.deepEqual(verifyWebhook(payload, header, "whsec_a", { now: NOW }), { id: "evt_1", type: "x" });
  });

  test("accepts any one of several v1 values, as while a secret is being rotated", () => {
    const header = `t=1700000000,v1=${hmac("whsec_old", 1700000000)},v1=${hmac("whsec_new", 1700000000)}`;
    assert.equal(verifyWebhook(payload, header, "whsec_new", { now: NOW }).id, "evt_1");
    assert.equal(verifyWebhook(payload, header, "whsec_old", { now: NOW }).id, "evt_1");
    assert.throws(() => verifyWebhook(payload, header, "whsec_third", { now: NOW }), { statusCode: 400 });
  });

  test("rejects a wrong secret, a changed body, a short or non-hex signature and a missing header", () => {
    const good = hmac("whsec_a", 1700000000);
    const bad = (header, body = payload, secret = "whsec_a") =>
      assert.throws(() => verifyWebhook(body, header, secret, { now: NOW }), { statusCode: 400 });

    bad(`t=1700000000,v1=${good}`, payload, "whsec_b");
    bad(`t=1700000000,v1=${good}`, Buffer.from("{}"));
    bad(`t=1700000000,v1=${good.slice(0, 20)}`);
    bad(`t=1700000000,v1=${"z".repeat(64)}`);
    bad(`v1=${good}`);
    bad("t=1700000000");
    bad(undefined);
    bad("");
  });

  test("rejects a timestamp outside the tolerance, in either direction", () => {
    const at = (t) => `t=${t},v1=${hmac("whsec_a", t)}`;
    assert.equal(verifyWebhook(payload, at(1700000000 - 299), "whsec_a", { now: NOW }).id, "evt_1");
    assert.throws(() => verifyWebhook(payload, at(1700000000 - 301), "whsec_a", { now: NOW }), { statusCode: 400 });
    assert.throws(() => verifyWebhook(payload, at(1700000000 + 301), "whsec_a", { now: NOW }), { statusCode: 400 });
    assert.equal(verifyWebhook(payload, at(1700000000 - 3000), "whsec_a", { now: NOW, toleranceSec: 4000 }).id, "evt_1");
  });

  test("rejects a body that was parsed instead of read raw", () => {
    assert.throws(() => verifyWebhook({}, "t=1,v1=ab", "whsec_a", { now: NOW }), { statusCode: 400 });
  });
});
