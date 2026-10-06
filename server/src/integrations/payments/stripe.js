import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { errorDetails, logError } from "../../utils/errorLog.js";

/**
 * Stripe, spoken to directly over its REST API (form-encoded, bearer key): one
 * call to start a Checkout payment and the check on the signature of what Stripe
 * sends back. No SDK - the surface is small and an SDK would be a dependency to
 * keep patched for two functions.
 *
 * Failures are thrown as errors a person can read, with `statusCode` set the way
 * our own API should answer. `report` marks the ones an admin must fix (a bad
 * key, a refused request); those are also written to the error log here.
 */
const API = "https://api.stripe.com/v1";

const fail = (statusCode, message, extra) => Object.assign(new Error(message), { statusCode, ...extra });

export const configured = () => Boolean(env.stripe.secretKey);

/**
 * Whether packs can be sold. Both keys are needed: the secret key takes the
 * payment, but it is the webhook's signing secret that lets us hear that it
 * happened. Selling with only the first would charge people and never credit
 * them.
 */
export const canSell = () => Boolean(env.stripe.secretKey && env.stripe.webhookSecret);

/** The error to raise for a Stripe reply that did not succeed. */
export function stripeError(httpStatus, body) {
  const detail = String(body?.error?.message || "").trim();

  if (httpStatus === 401 || httpStatus === 403) {
    return fail(503, "Payments are not set up correctly: Stripe rejected the key. An admin can fix it in Admin -> API Keys.", {
      report: true,
    });
  }
  if (httpStatus === 429) return fail(429, "The payment service is busy. Try again in a moment.");
  return fail(502, `The payment service could not start that purchase${detail ? `: ${detail}` : ""}.`, { report: true });
}

/** Writes an admin-facing log row for a failure the person cannot fix. */
function report(err, userId) {
  if (err.report) {
    logError({
      errorType: "PAYMENT_CHECKOUT",
      message: err.message,
      functionName: "stripe.createCheckoutSession",
      // Never the key or the request body: the message and stack are enough.
      details: errorDetails(err, { userId: String(userId) }),
    });
  }
  return err;
}

/** Stripe's bracket notation: { a: { b: 1 } } -> a[b]=1. */
function form(fields) {
  const params = new URLSearchParams();
  const walk = (prefix, value) => {
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(`${prefix}[${k}]`, v);
    } else if (value !== undefined && value !== null) {
      params.append(prefix, String(value));
    }
  };
  for (const [k, v] of Object.entries(fields)) walk(k, v);
  return params;
}

/**
 * Starts a one-off payment for a credit pack.
 * The metadata is what the webhook later reads to know who gets what; it is set
 * on the session and on the payment intent, so refunds can be traced back too.
 *
 * @returns {Promise<{ id: string, url: string }>}
 */
export async function createCheckoutSession({ pack, workspaceId, userId, email, successUrl, cancelUrl }) {
  if (!configured()) throw fail(503, "Buying credits is not set up yet.");

  const metadata = {
    workspaceId: String(workspaceId),
    userId: String(userId),
    packId: String(pack._id),
    credits: pack.credits,
    packName: pack.name,
  };
  const body = form({
    mode: "payment",
    line_items: {
      0: {
        quantity: 1,
        price_data: {
          currency: pack.currency,
          unit_amount: pack.priceCents,
          product_data: { name: `${pack.credits} credits - ${pack.name}` },
        },
      },
    },
    client_reference_id: String(workspaceId),
    customer_email: email,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata,
    payment_intent_data: { metadata },
  });

  try {
    let res;
    try {
      res = await fetch(`${API}/checkout/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.stripe.secretKey}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw fail(502, "Could not reach the payment service. Try again in a moment.", { report: true, cause: err });
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw stripeError(res.status, json);
    if (!json?.id || !json?.url) throw fail(502, "The payment service did not return a payment page. Try again.", { report: true });
    return { id: json.id, url: json.url };
  } catch (err) {
    throw report(err, userId);
  }
}

const hex = /^[0-9a-f]+$/i;

/**
 * Checks a webhook the way Stripe signs it: the header is
 * `t=<unix>,v1=<hex>[,v1=<hex>]` and each v1 is HMAC-SHA256 of `${t}.${rawBody}`
 * with the endpoint's whsec_ secret. Several v1 values appear while a secret is
 * being rotated, so any one matching is enough. The timestamp must be recent, or
 * a captured request could be replayed forever.
 *
 * @param {Buffer} rawBody exactly the bytes Stripe sent
 * @returns the parsed event
 */
export function verifyWebhook(rawBody, signatureHeader, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  const bad = (why) => fail(400, `Webhook signature check failed: ${why}.`);
  if (!Buffer.isBuffer(rawBody)) throw bad("the body was not read raw");
  if (!signatureHeader || typeof signatureHeader !== "string") throw bad("no signature");

  let timestamp = null;
  const signatures = [];
  for (const part of signatureHeader.split(",")) {
    const i = part.indexOf("=");
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") timestamp = v;
    else if (k === "v1" && hex.test(v)) signatures.push(v);
  }
  if (!/^\d+$/.test(timestamp || "") || !signatures.length) throw bad("malformed signature");

  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
  const matches = signatures.some((sig) => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
  if (!matches) throw bad("signature does not match");

  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSec) throw bad("timestamp outside the allowed window");

  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw bad("body is not JSON");
  }
}
