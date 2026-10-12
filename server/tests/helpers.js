import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

/**
 * Boots the real app against a throwaway database and returns a client that is
 * already signed in.
 *
 * Every test goes through registration rather than inserting a user directly,
 * so the auth path is exercised by every suite instead of only its own.
 */
export async function startTestApp({ seed: runSeed = true } = {}) {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const { createApp } = await import("../src/app.js");
  // Indexes are built in the background after a model is registered, and the
  // unique ones are what make grants and charges idempotent. Wait for them, or
  // a request that arrives first (credits are granted when first read) would
  // run without them and a test would see a double grant that cannot happen
  // in a server that has been up for more than a moment.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  const seeded = runSeed ? await (await import("../src/scripts/seed.js")).seed() : null;

  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    seeded,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
      await mongod.stop();
    },
  };
}

/** Registers a fresh account and returns a client bound to its token. */
export async function signUp(baseUrl, overrides = {}) {
  const email = overrides.email || `user-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const password = overrides.password || "test-password-123";

  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: "Test user", ...overrides }),
  });

  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const body = await res.json();

  return { ...body, email, password, ...client(baseUrl, body.accessToken) };
}

/** Same shape as `signUp` but for an account that already exists. */
export async function signIn(baseUrl, { email, password }) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const body = await res.json();
  return { ...body, ...client(baseUrl, body.accessToken) };
}

function client(baseUrl, token) {
  const auth = token ? { authorization: `Bearer ${token}` } : {};

  const json = async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...auth, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  return {
    token,
    get: (path) => json("GET", path),
    post: (path, body) => json("POST", path, body),
    put: (path, body) => json("PUT", path, body),
    patch: (path, body) => json("PATCH", path, body),
    del: (path) => json("DELETE", path),
    /** Multipart upload; FormData sets its own content-type boundary. */
    async upload(path, form) {
      const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers: auth, body: form });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
  };
}
