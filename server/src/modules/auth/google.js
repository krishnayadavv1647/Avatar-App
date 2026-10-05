import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

/**
 * Checks a Google Sign-In ID token (the `credential` the Google button hands
 * the browser) and returns who it belongs to.
 *
 * The token is a JWT signed by Google. It is verified locally against Google's
 * published keys - signature, audience (our client id), issuer and expiry - so
 * a token minted for some other site, or edited in the browser, is refused.
 * The keys are cached for as long as Google's Cache-Control says.
 */
const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

let cache = { keys: null, expiresAt: 0 };

async function googleKeys({ refresh = false } = {}) {
  if (!refresh && cache.keys && Date.now() < cache.expiresAt) return cache.keys;

  const res = await fetch(CERTS_URL);
  if (!res.ok) throw unavailable();
  const { keys } = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1]) || 3600;

  cache = {
    keys: new Map(keys.map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" })])),
    expiresAt: Date.now() + maxAge * 1000,
  };
  return cache.keys;
}

export const googleEnabled = () => Boolean(env.google.clientId);

/** @returns {Promise<{ sub: string, email: string, name?: string }>} */
export async function verifyGoogleIdToken(idToken) {
  if (!googleEnabled()) throw Object.assign(new Error("Google sign-in is not set up"), { statusCode: 404 });

  const kid = jwt.decode(idToken, { complete: true })?.header?.kid;
  if (!kid) throw invalid();

  // Google rotates its keys; an unknown kid means ours may be stale.
  let key = (await googleKeys()).get(kid) || (await googleKeys({ refresh: true })).get(kid);
  if (!key) throw invalid();

  let claims;
  try {
    claims = jwt.verify(idToken, key, {
      algorithms: ["RS256"],
      audience: env.google.clientId,
      issuer: ISSUERS,
    });
  } catch {
    throw invalid();
  }

  // An unverified address could belong to anyone, and email is how accounts
  // are matched - so it is never trusted.
  if (!claims.email || claims.email_verified !== true) {
    throw Object.assign(new Error("Your Google account's email is not verified"), { statusCode: 401 });
  }

  return { sub: claims.sub, email: claims.email.toLowerCase(), name: claims.name };
}

function invalid() {
  return Object.assign(new Error("Google sign-in failed. Try again."), { statusCode: 401 });
}

function unavailable() {
  return Object.assign(new Error("Could not reach Google. Try again."), { statusCode: 503 });
}
