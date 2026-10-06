/**
 * The System & Config admin tabs: analytics, credit usage, API keys, app
 * config and error logs.
 *
 * What matters most here is that secrets never leave the server and that a key
 * saved in the panel really replaces the environment's, so those get the
 * closest attention; the rest checks the numbers and the actions.
 */
import "../setup-env.js";
import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { signIn, signUp, startTestApp } from "../helpers.js";
import { DEMO_EMAIL, DEMO_PASSWORD } from "../../src/scripts/seed.js";
import { env } from "../../src/config/env.js";
import {
  ApiConfiguration,
  Avatar,
  Conversation,
  ErrorLog,
  SystemConfig,
  UsageLedger,
  User,
} from "../../src/models/index.js";
import { applyApiConfigs, classifyProbe, forgetEnvOriginals } from "../../src/modules/admin/system/apiConfig.service.js";
import { startOfDay, startOfMonth } from "../../src/modules/admin/system/analytics.service.js";
import { getProvider } from "../../src/avatar/providers/registry.js";
import { getStorage } from "../../src/integrations/storage/registry.js";
import { logError } from "../../src/utils/errorLog.js";

let app;
let admin;
let demo;
let avatar;
let adminUser;

const MIN = 60;
const DAY = 24 * 60 * 60 * 1000;

before(async () => {
  app = await startTestApp();
  // Secrets are sealed with this; a bare test environment has neither variable.
  env.mcpEncryptionKey = "test-encryption-key-for-admin-system";
  admin = await signUp(app.baseUrl, { email: "admin@example.com", name: "Admin" });
  demo = await signIn(app.baseUrl, { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  avatar = app.seeded.avatar;
  adminUser = await User.findOne({ email: "admin@example.com" });
});

after(() => app.stop());

/** One finished call plus the ledger row the app writes for it. */
async function call({ providerId = "lemonslice", minutes, userId, guestName, createdAt = new Date(), costCents }) {
  const conversation = await Conversation.create({
    workspaceId: avatar.workspaceId,
    avatarId: avatar._id,
    userId,
    source: userId ? "app" : "link",
    guest: guestName ? { name: guestName } : undefined,
    roomName: `room-${new mongoose.Types.ObjectId()}`,
    providerId,
    pipelineMode: "render-only",
    transport: "livekit",
    status: "ended",
    durationSec: Math.round(minutes * MIN),
    createdAt,
  });
  await UsageLedger.create({
    workspaceId: avatar.workspaceId,
    conversationId: conversation._id,
    providerId,
    minutes,
    costCents: costCents ?? Math.round(minutes * 16.4),
    kind: "conversation",
    createdAt,
  });
  return conversation;
}

const resetCalls = () => Promise.all([Conversation.deleteMany({}), UsageLedger.deleteMany({})]);

describe("access", () => {
  test("every system route refuses non-admins", async () => {
    for (const path of [
      "/api/admin/analytics",
      "/api/admin/credit-usage",
      "/api/admin/api-configs",
      "/api/admin/config",
      "/api/admin/error-logs",
    ]) {
      assert.equal((await demo.get(path)).status, 403, path);
    }
    assert.equal((await demo.put("/api/admin/config", { settings: {} })).status, 403);
    assert.equal((await demo.post("/api/admin/api-configs/lemonslice/test")).status, 403);
    assert.equal((await demo.del("/api/admin/error-logs/resolved")).status, 403);
  });
});

describe("time zones", () => {
  test("a day starts at local midnight, not 24 hours ago", () => {
    // 01:30 on 2 Jan in Kolkata is 20:00 UTC on 1 Jan; local midnight was 18:30 UTC.
    const now = Date.UTC(2026, 0, 1, 20, 0);
    assert.equal(startOfDay(now, "Asia/Kolkata").toISOString(), "2026-01-01T18:30:00.000Z");
    assert.equal(startOfDay(now, "Asia/Kolkata", 6).toISOString(), "2025-12-26T18:30:00.000Z");
    assert.equal(startOfDay(now, "UTC").toISOString(), "2026-01-01T00:00:00.000Z");
  });

  test("a month start crosses the year boundary", () => {
    const now = Date.UTC(2026, 0, 15, 12, 0);
    assert.equal(startOfMonth(now, "UTC", 0).toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(startOfMonth(now, "UTC", 1).toISOString(), "2025-12-01T00:00:00.000Z");
  });
});

describe("analytics", () => {
  beforeEach(resetCalls);

  test("counts this calendar month and compares it with the last", async () => {
    const now = Date.now();
    const lastMonth = new Date(startOfMonth(now, "UTC", 1).getTime() + 5 * DAY);
    await call({ minutes: 10, userId: adminUser._id });
    await call({ minutes: 20, userId: adminUser._id });
    await call({ minutes: 30, userId: adminUser._id, createdAt: lastMonth });

    const { status, body } = await admin.get("/api/admin/analytics?tz=UTC");

    assert.equal(status, 200);
    assert.equal(body.month.calls.value, 2);
    assert.equal(body.month.minutes.value, 30);
    // 2 calls now against 1 last month; 30 minutes against 30.
    assert.equal(body.month.calls.change, 100);
    assert.equal(body.month.minutes.change, 0);
  });

  test("has no trend when there is nothing to compare with", async () => {
    await call({ minutes: 5, userId: adminUser._id });
    const { body } = await admin.get("/api/admin/analytics?tz=UTC");
    assert.equal(body.month.calls.change, null);
    assert.equal(body.month.minutes.change, null);
  });

  test("ranks users by minutes, not by what is left in their account", async () => {
    const demoUser = await User.findOne({ email: DEMO_EMAIL });
    await call({ minutes: 5, userId: adminUser._id });
    await call({ minutes: 50, userId: demoUser._id });
    await call({ minutes: 7, guestName: "A visitor" });

    const { body } = await admin.get("/api/admin/analytics");

    assert.deepEqual(body.topUsers.map((u) => [u.email, u.minutes]), [
      [DEMO_EMAIL, 50],
      ["admin@example.com", 5],
    ]);
    assert.ok("plan" in body.topUsers[0]);
  });

  test("lists the latest ten calls, guests included", async () => {
    for (let i = 0; i < 12; i++) await call({ minutes: 1, userId: adminUser._id, createdAt: new Date(Date.now() - i * 1000) });
    await call({ minutes: 2, guestName: "A visitor" });

    const { body } = await admin.get("/api/admin/analytics");

    assert.equal(body.recent.length, 10);
    assert.equal(body.recent[0].guest, "A visitor");
    assert.equal(body.recent[0].source, "link");
    assert.equal(body.recent[0].avatar, avatar.name);
  });

  test("reports empty usage as zeros", async () => {
    const { body } = await admin.get("/api/admin/analytics");
    assert.equal(body.month.calls.value, 0);
    assert.deepEqual(body.topUsers, []);
    assert.deepEqual(body.recent, []);
  });
});

describe("credit usage", () => {
  beforeEach(async () => {
    await resetCalls();
    await SystemConfig.deleteOne({ key: "api_cost_rules" });
  });

  test("groups minutes and cost by avatar, vendor and user", async () => {
    const demoUser = await User.findOne({ email: DEMO_EMAIL });
    await call({ providerId: "lemonslice", minutes: 10, userId: adminUser._id, costCents: 164 });
    await call({ providerId: "lemonslice", minutes: 5, userId: demoUser._id, costCents: 82 });
    await call({ providerId: "mock", minutes: 3, guestName: "A visitor", costCents: 0 });

    const { status, body } = await admin.get("/api/admin/credit-usage?days=30&tz=UTC");

    assert.equal(status, 200);
    assert.equal(body.totals.uses, 3);
    assert.equal(body.totals.minutes, 18);
    assert.equal(body.totals.estimatedCents, 246);
    assert.deepEqual(body.byProvider.map((g) => [g.key, g.uses, g.minutes, g.estimatedCents]), [
      ["lemonslice", 2, 15, 246],
      ["mock", 1, 3, 0],
    ]);
    assert.equal(body.byAvatar.length, 1);
    assert.equal(body.byAvatar[0].label, avatar.name);
    // Ordered by cost, and guests get their own row.
    assert.deepEqual(body.byUser.map((g) => g.label), ["admin@example.com", DEMO_EMAIL, "Guests / not linked to a user"]);
  });

  test("starts with actual cost equal to estimated, so the difference is zero", async () => {
    await call({ providerId: "lemonslice", minutes: 10, userId: adminUser._id, costCents: 164 });
    const { body } = await admin.get("/api/admin/credit-usage");
    assert.equal(body.totals.actualCents, 164);
    assert.equal(body.totals.differenceCents, 0);
  });

  test("lists every known provider as a cost rule, used or not, with defaults", async () => {
    const { body } = await admin.get("/api/admin/credit-usage");
    const ids = body.rules.map((r) => r.providerId);
    for (const id of ["mock", "mock-hosted", "lemonslice", "simli", "heygen"]) assert.ok(ids.includes(id), id);
    const lemon = body.rules.find((r) => r.providerId === "lemonslice");
    assert.equal(lemon.rate, 0.164);
    assert.equal(lemon.custom, false);
  });

  test("a saved rule changes actual cost and the difference", async () => {
    await call({ providerId: "lemonslice", minutes: 10, userId: adminUser._id, costCents: 164 });

    const saved = await admin.put("/api/admin/credit-usage/rules", { rules: { lemonslice: 0.2 } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.rules.find((r) => r.providerId === "lemonslice").custom, true);

    const { body } = await admin.get("/api/admin/credit-usage");
    // 10 minutes at $0.20 is $2.00; the ledger said $1.64.
    assert.equal(body.totals.actualCents, 200);
    assert.equal(body.totals.differenceCents, -36);
    assert.equal(body.byProvider[0].differenceCents, -36);

    const row = await SystemConfig.findOne({ key: "api_cost_rules" });
    assert.deepEqual(JSON.parse(row.value), { lemonslice: 0.2 });

    // Clearing a rule falls back to the default.
    await admin.put("/api/admin/credit-usage/rules", { rules: {} });
    assert.equal((await admin.get("/api/admin/credit-usage")).body.totals.differenceCents, 0);
  });

  test("rejects bad rules", async () => {
    assert.equal((await admin.put("/api/admin/credit-usage/rules", { rules: { lemonslice: -1 } })).status, 400);
    assert.equal((await admin.put("/api/admin/credit-usage/rules", { rules: { lemonslice: "abc" } })).status, 400);
    assert.equal((await admin.put("/api/admin/credit-usage/rules", { rules: { nobody: 1 } })).status, 400);
  });

  test("the period picker: today means since local midnight, and only 1/7/30/90 are accepted", async () => {
    await call({ minutes: 4, userId: adminUser._id });
    await call({ minutes: 6, userId: adminUser._id, createdAt: new Date(Date.now() - 3 * DAY) });
    await call({ minutes: 8, userId: adminUser._id, createdAt: new Date(Date.now() - 40 * DAY) });

    const minutes = async (days) => (await admin.get(`/api/admin/credit-usage?days=${days}&tz=UTC`)).body.totals.minutes;
    assert.equal(await minutes(1), 4);
    assert.equal(await minutes(7), 10);
    assert.equal(await minutes(30), 10);
    assert.equal(await minutes(90), 18);
    assert.equal((await admin.get("/api/admin/credit-usage?days=5")).status, 400);
  });

  test("ledger rows that are not calls do not count as uses", async () => {
    await call({ minutes: 10, userId: adminUser._id });
    await UsageLedger.create({ workspaceId: avatar.workspaceId, minutes: -2, costCents: -33, kind: "adjustment", providerId: "lemonslice" });

    const { body } = await admin.get("/api/admin/credit-usage");
    assert.equal(body.totals.uses, 1);
    assert.equal(body.totals.minutes, 8);
    assert.ok(body.byAvatar.some((g) => g.label === "Not linked to an avatar"));
  });

  test("an empty period is all zeros", async () => {
    const { body } = await admin.get("/api/admin/credit-usage");
    assert.equal(body.totals.uses, 0);
    assert.deepEqual(body.byAvatar, []);
  });
});

describe("API keys", () => {
  const KEY = "sk-live-0123456789abcdefWXYZ";

  beforeEach(async () => {
    await ApiConfiguration.deleteMany({});
    // Independent of the developer's own .env, whatever it holds.
    env.lemonsliceApiKey = "";
    env.anthropicApiKey = "";
    env.elevenlabs.apiKey = "";
    forgetEnvOriginals();
    await applyApiConfigs();
  });

  test("seeds this app's providers and flags the required one", async () => {
    const { status, body } = await admin.get("/api/admin/api-configs");

    assert.equal(status, 200);
    assert.deepEqual(body.configs.map((c) => c.serviceName), ["lemonslice", "anthropic", "elevenlabs"]);
    const lemon = body.configs[0];
    assert.equal(lemon.required, true);
    assert.equal(lemon.envVar, "LEMONSLICE_API_KEY");
    assert.deepEqual(lemon.key, { hasKey: false, last4: null, source: "none", storedInDatabase: false });
    assert.deepEqual(body.environment.map((e) => e.id), ["livekit", "storage", "stripe"]);
  });

  test("never returns a key, in any response or in the database as plain text", async () => {
    const saved = await admin.put("/api/admin/api-configs/lemonslice", { apiKey: KEY });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.config.key, { hasKey: true, last4: "WXYZ", source: "database", storedInDatabase: true });

    const responses = [
      JSON.stringify(saved.body),
      JSON.stringify((await admin.get("/api/admin/api-configs")).body),
      JSON.stringify((await admin.post("/api/admin/api-configs/lemonslice/test")).body),
    ];
    for (const text of responses) assert.ok(!text.includes(KEY) && !text.includes("0123456789abcdef"), "key leaked");

    const raw = await ApiConfiguration.findOne({ serviceName: "lemonslice" }).lean();
    assert.ok(raw.apiKey && !raw.apiKey.includes("0123456789"), "stored key is sealed");
  });

  test("a saved key replaces the environment's, and switching off puts it back", async () => {
    env.lemonsliceApiKey = "from-environment";
    // Boot would have captured it; do the same.
    forgetEnvOriginals();
    await applyApiConfigs();
    assert.equal(env.lemonsliceApiKey, "from-environment");

    await admin.put("/api/admin/api-configs/lemonslice", { apiKey: KEY });
    assert.equal(env.lemonsliceApiKey, KEY, "applied immediately, in this process");
    assert.equal(getProvider("lemonslice").apiKey, KEY, "the cached provider follows too");

    const off = await admin.put("/api/admin/api-configs/lemonslice", { isActive: false });
    assert.equal(env.lemonsliceApiKey, "from-environment");
    assert.equal(off.body.config.key.source, "environment");
    assert.equal(off.body.config.key.storedInDatabase, true);

    await admin.put("/api/admin/api-configs/lemonslice", { isActive: true });
    assert.equal(env.lemonsliceApiKey, KEY);

    // A fresh boot (or an agent job) reads the same thing from the database.
    env.lemonsliceApiKey = "";
    assert.deepEqual(await applyApiConfigs(), ["lemonslice"]);
    assert.equal(env.lemonsliceApiKey, KEY);

    await admin.put("/api/admin/api-configs/lemonslice", { clearKey: true });
    assert.equal(env.lemonsliceApiKey, "from-environment");
    env.lemonsliceApiKey = "";
    await applyApiConfigs();
  });

  test("applies the other providers' keys to the fields they are read from", async () => {
    await admin.put("/api/admin/api-configs/anthropic", { apiKey: "anthropic-key-1234567890" });
    await admin.put("/api/admin/api-configs/elevenlabs", { apiKey: "eleven-key-1234567890" });
    assert.equal(env.anthropicApiKey, "anthropic-key-1234567890");
    assert.equal(env.elevenlabs.apiKey, "eleven-key-1234567890");
    await ApiConfiguration.deleteMany({});
    await applyApiConfigs();
    assert.equal(env.anthropicApiKey, "");
    assert.equal(env.elevenlabs.apiKey, "");
  });

  test("only changes the key when a new one is submitted", async () => {
    await admin.put("/api/admin/api-configs/lemonslice", { apiKey: KEY });
    const res = await admin.put("/api/admin/api-configs/lemonslice", { baseUrl: "https://example.test/api" });

    assert.equal(res.body.config.baseUrl, "https://example.test/api");
    assert.equal(res.body.config.key.last4, "WXYZ");
    assert.equal(env.lemonsliceApiKey, KEY);
  });

  test("validates what is submitted", async () => {
    assert.equal((await admin.put("/api/admin/api-configs/lemonslice", { apiKey: "short" })).status, 400);
    assert.equal((await admin.put("/api/admin/api-configs/lemonslice", { baseUrl: "ftp://x" })).status, 400);
    assert.equal((await admin.put("/api/admin/api-configs/lemonslice", { surprise: 1 })).status, 400);
    assert.equal((await admin.put("/api/admin/api-configs/nobody", { isActive: true })).status, 404);
  });

  test("refuses to test when there is no key", async () => {
    assert.equal((await admin.post("/api/admin/api-configs/anthropic/test")).status, 400);
  });

  describe("test connection", () => {
    const realFetch = globalThis.fetch;
    let seen;
    let answer;

    before(() => {
      // Only vendor addresses are faked; the test client's own calls pass through.
      globalThis.fetch = async (url, init) => {
        if (String(url).startsWith("https://lemonslice.com/")) {
          seen = { url: String(url), headers: init?.headers };
          if (answer instanceof Error) throw answer;
          return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
        }
        return realFetch(url, init);
      };
    });
    after(() => {
      globalThis.fetch = realFetch;
    });

    const run = async (reply) => {
      answer = reply;
      return (await admin.post("/api/admin/api-configs/lemonslice/test")).body;
    };
    const stats = async () => (await ApiConfiguration.findOne({ serviceName: "lemonslice" }).lean()).usageStats;

    test("classifies the vendor's answer", async () => {
      await admin.put("/api/admin/api-configs/lemonslice", { apiKey: KEY });

      let r = await run({ status: 200 });
      assert.deepEqual([r.outcome, r.ok, r.source], ["valid", true, "database"]);
      assert.equal(r.message, "Connection successful! API key is valid and working properly.");
      assert.equal(seen.headers["X-API-Key"], KEY, "the real key is sent, server-side");

      r = await run({ status: 401 });
      assert.deepEqual([r.outcome, r.ok], ["invalid", false]);
      assert.equal(r.message, "Authentication failed (401): Invalid API key or insufficient permissions.");
      assert.equal((await run({ status: 403 })).outcome, "invalid");

      r = await run({ status: 429 });
      assert.deepEqual([r.outcome, r.ok], ["rate_limited", false]);
      assert.match(r.message, /^Rate limit exceeded \(429\)/);

      r = await run({ status: 500, body: { message: "upstream exploded" } });
      assert.deepEqual([r.outcome, r.ok], ["warning", true]);
      assert.equal(r.message, "API key is valid, but test request failed with: upstream exploded");

      r = await run(new Error("getaddrinfo ENOTFOUND"));
      assert.deepEqual([r.outcome, r.ok], ["error", false]);
      assert.match(r.message, /^Connection test failed: getaddrinfo ENOTFOUND/);
    });

    test("updates the request counters", async () => {
      await admin.put("/api/admin/api-configs/lemonslice", { apiKey: KEY });
      await run({ status: 200 });
      await run({ status: 401 });
      await run({ status: 500 });

      const s = await stats();
      assert.equal(s.totalRequests, 3);
      assert.equal(s.successfulRequests, 2);
      assert.equal(s.failedRequests, 1);
      assert.ok(s.lastUsed);

      const { body } = await admin.get("/api/admin/api-configs");
      assert.equal(body.configs[0].usageStats.totalRequests, 3);
    });

    test("tests the environment's key when none is saved", async () => {
      env.lemonsliceApiKey = "environment-key-abcd";
      forgetEnvOriginals();
      await applyApiConfigs();
      const r = await run({ status: 200 });
      assert.equal(r.source, "environment");
      assert.equal(seen.headers["X-API-Key"], "environment-key-abcd");
    });
  });

  test("classifyProbe reads the vendor's own error shapes", () => {
    assert.equal(classifyProbe(400, { error: { message: "nope" } }).message, "API key is valid, but test request failed with: nope");
    assert.equal(classifyProbe(400, { detail: { message: "bad" } }).message, "API key is valid, but test request failed with: bad");
    assert.equal(classifyProbe(418, null).message, "API key is valid, but test request failed with: HTTP 418");
  });

  test("storage check writes and removes a probe", async () => {
    const { status, body } = await admin.post("/api/admin/system/storage-test");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.driver, "local");
  });
});

describe("app config", () => {
  beforeEach(async () => {
    await SystemConfig.deleteMany({ key: { $ne: "api_cost_rules" } });
    // An empty save writes nothing but drops the public config's short cache.
    await admin.put("/api/admin/config", { settings: {} });
  });

  test("serves the form with defaults, definitions and the MCP address", async () => {
    const { status, body } = await admin.get("/api/admin/config");

    assert.equal(status, 200);
    assert.equal(body.settings.app_name, "Avatar Studio");
    assert.equal(body.settings.support_email, "");
    assert.deepEqual(
      body.definitions.map((d) => d.key),
      ["app_name", "app_public_domain", "buy_plan_url", "support_email", "welcome_video_url", "walkthrough_video_url", "logo_url", "favicon_url"],
    );
    assert.ok(body.mcpUrl.endsWith("/api/mcp"));
    assert.equal(JSON.stringify(body).includes(admin.token), false, "no session token anywhere");
  });

  test("saves, normalises YouTube links and reports the MCP address from the domain", async () => {
    const { status, body } = await admin.put("/api/admin/config", {
      settings: {
        app_name: "  Acme Avatars ",
        app_public_domain: "https://app.acme.test/",
        support_email: "help@acme.test",
        welcome_video_url: "https://youtu.be/abc123?t=4",
        walkthrough_video_url: "https://www.youtube.com/watch?v=xyz789&list=1",
      },
    });

    assert.equal(status, 200);
    assert.equal(body.settings.app_name, "Acme Avatars");
    assert.equal(body.settings.welcome_video_url, "https://www.youtube.com/embed/abc123");
    assert.equal(body.settings.walkthrough_video_url, "https://www.youtube.com/embed/xyz789");
    assert.equal(body.mcpUrl, "https://app.acme.test/api/mcp");
  });

  test("rejects invalid values and saves nothing", async () => {
    const { status, body } = await admin.put("/api/admin/config", {
      settings: { app_name: "Fine", support_email: "not-an-email", buy_plan_url: "javascript:alert(1)", logo_url: "ftp://x" },
    });

    assert.equal(status, 400);
    assert.equal(body.error.details.length, 3);
    assert.equal((await SystemConfig.findOne({ key: "app_name" })), null, "all or nothing");
    assert.equal((await admin.put("/api/admin/config", { settings: { nope: "x" } })).status, 400);
    assert.equal((await admin.put("/api/admin/config", { settings: { app_name: "x".repeat(61) } })).status, 400);
  });

  test("accepts a path on this site as an image address", async () => {
    const { status } = await admin.put("/api/admin/config", { settings: { logo_url: "/uploads/branding/x.png", favicon_url: "https://cdn.test/f.ico" } });
    assert.equal(status, 200);
  });

  test("the public config is open, partial, and follows a save", async () => {
    await admin.put("/api/admin/config", {
      settings: { app_name: "Acme", app_public_domain: "https://app.acme.test", support_email: "help@acme.test", logo_url: "https://cdn.test/l.png" },
    });

    const res = await fetch(`${app.baseUrl}/api/config`);
    const body = await res.json();

    assert.equal(res.status, 200, "no sign-in needed");
    assert.equal(body.app_name, "Acme");
    assert.equal(body.logo_url, "https://cdn.test/l.png");
    assert.equal(body.support_email, "help@acme.test");
    assert.equal("app_public_domain" in body, false, "the private setting is not exposed");
    assert.deepEqual(Object.keys(body).sort(), [
      "app_name", "buy_plan_url", "favicon_url", "logo_url", "support_email", "walkthrough_video_url", "welcome_video_url",
    ]);
  });

  test("unset branding leaves the app as it was", async () => {
    const body = await (await fetch(`${app.baseUrl}/api/config`)).json();
    assert.equal(body.app_name, "Avatar Studio");
    assert.equal(body.logo_url, "");
    assert.equal(body.favicon_url, "");
  });

  test("uploads a logo and refuses what is not an image", async () => {
    const png = new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" });
    const form = new FormData();
    form.append("file", png, "logo.png");
    const ok = await admin.upload("/api/admin/config/upload", form);
    assert.equal(ok.status, 201);
    assert.match(ok.body.url, /\/uploads\/branding\/.+\.png$/);

    const bad = new FormData();
    bad.append("file", new Blob(["hello"], { type: "text/plain" }), "x.txt");
    const rejected = await admin.upload("/api/admin/config/upload", bad);
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error.message, /^Invalid file type: text\/plain/);

    assert.equal((await admin.upload("/api/admin/config/upload", new FormData())).status, 400);
  });
});

describe("error logs", () => {
  const T = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000);
  const seedLogs = () =>
    ErrorLog.insertMany([
      { timestamp: T(1), severity: "INFO", status: "NEW", errorType: "A", message: "info newest", functionName: "alpha" },
      { timestamp: T(2), severity: "CRITICAL", status: "NEW", errorType: "B", message: "critical disk", functionName: "beta", userEmail: "pat@example.com" },
      { timestamp: T(3), severity: "WARNING", status: "ACKNOWLEDGED", errorType: "C", message: "warning slow", functionName: "gamma" },
      { timestamp: T(4), severity: "ERROR", status: "RESOLVED", errorType: "D", message: "error old", functionName: "alpha", details: { stack: "s" } },
      { timestamp: T(5), severity: "ERROR", status: "NEW", errorType: "E", message: "error [regex] (chars)", functionName: "delta" },
    ]);

  beforeEach(async () => {
    await ErrorLog.deleteMany({});
    await seedLogs();
  });

  const list = async (qs = "") => (await admin.get(`/api/admin/error-logs${qs}`)).body;
  const messages = (b) => b.logs.map((l) => l.message);

  test("lists newest first with the fields the table shows", async () => {
    const body = await list();
    assert.equal(body.total, 5);
    assert.equal(body.logs[0].message, "info newest");
    assert.deepEqual(body.counts, { NEW: 3, ACKNOWLEDGED: 1, RESOLVED: 1 });
    const log = body.logs.find((l) => l.message === "critical disk");
    assert.equal(log.errorType, "B");
    assert.equal(log.userEmail, "pat@example.com");
    assert.equal(log.functionName, "beta");
  });

  test("sorts timestamp both ways", async () => {
    assert.equal(messages(await list("?sort=timestamp&dir=asc"))[0], "error [regex] (chars)");
    assert.equal(messages(await list("?sort=timestamp&dir=desc"))[0], "info newest");
  });

  test("sorts severity by rank, not alphabetically", async () => {
    const severities = async (dir) => (await list(`?sort=severity&dir=${dir}`)).logs.map((l) => l.severity);
    assert.deepEqual(await severities("desc"), ["CRITICAL", "ERROR", "ERROR", "WARNING", "INFO"]);
    assert.deepEqual(await severities("asc"), ["INFO", "WARNING", "ERROR", "ERROR", "CRITICAL"]);
  });

  test("searches message, user email and function, treating the query as text", async () => {
    assert.deepEqual(messages(await list("?q=DISK")), ["critical disk"]);
    assert.deepEqual(messages(await list("?q=pat@example")), ["critical disk"]);
    assert.equal((await list("?q=alpha")).total, 2);
    assert.deepEqual(messages(await list(`?q=${encodeURIComponent("[regex] (chars)")}`)), ["error [regex] (chars)"]);
    assert.equal((await list("?q=nothing-like-this")).total, 0);
  });

  test("filters by severity and status, together with search", async () => {
    assert.equal((await list("?severity=ERROR")).total, 2);
    assert.equal((await list("?status=NEW")).total, 3);
    assert.equal((await list("?severity=ERROR&status=NEW")).total, 1);
    assert.equal((await list("?severity=ERROR&q=alpha")).total, 1);
    assert.equal((await admin.get("/api/admin/error-logs?severity=LOUD")).status, 400);
  });

  test("pages on the server", async () => {
    const first = await list("?limit=2&page=1");
    const third = await list("?limit=2&page=3");
    assert.equal(first.logs.length, 2);
    assert.equal(first.total, 5);
    assert.equal(third.logs.length, 1);
    assert.equal(first.pageSize, 2);
  });

  test("acknowledges and resolves", async () => {
    const [target] = (await list("?status=NEW&severity=CRITICAL")).logs;
    assert.deepEqual((await admin.patch(`/api/admin/error-logs/${target.id}`, { status: "ACKNOWLEDGED" })).body, {
      id: target.id,
      status: "ACKNOWLEDGED",
    });
    assert.equal((await ErrorLog.findById(target.id)).status, "ACKNOWLEDGED");
    assert.equal((await admin.patch(`/api/admin/error-logs/${target.id}`, { status: "RESOLVED" })).status, 200);
    assert.equal((await admin.patch(`/api/admin/error-logs/${target.id}`, { status: "DONE" })).status, 400);
    assert.equal((await admin.patch(`/api/admin/error-logs/${new mongoose.Types.ObjectId()}`, { status: "NEW" })).status, 404);
  });

  test("deletes one", async () => {
    const [target] = (await list()).logs;
    assert.equal((await admin.del(`/api/admin/error-logs/${target.id}`)).status, 200);
    assert.equal((await list()).total, 4);
    assert.equal((await admin.del(`/api/admin/error-logs/${target.id}`)).status, 404);
    assert.equal((await admin.del("/api/admin/error-logs/not-an-id")).status, 400);
  });

  test("clears only what is resolved", async () => {
    const res = await admin.del("/api/admin/error-logs/resolved");
    assert.deepEqual(res.body, { deleted: 1 });
    const left = await list();
    assert.equal(left.total, 4);
    assert.equal(left.counts.RESOLVED, 0);
    assert.ok(!messages(left).includes("error old"));
  });

  test("returns details for the dialog", async () => {
    const log = (await list("?q=error old")).logs[0];
    assert.deepEqual(log.details, { stack: "s" });
  });
});

describe("error logging helper", () => {
  test("records an entry with defaults, and never throws", async () => {
    await ErrorLog.deleteMany({});
    await logError({ errorType: "CALL_FAILED", message: "x".repeat(5000), details: { room: "r" } });
    await logError({});

    const [first, second] = await ErrorLog.find().sort({ createdAt: 1 }).lean();
    assert.equal(first.message.length, 2000);
    assert.equal(first.severity, "ERROR");
    assert.equal(first.status, "NEW");
    assert.equal(second.errorType, "ERROR");
    assert.equal(second.message, "Unknown error");
  });

  test("a storage failure is reported to the admin, not thrown", async () => {
    const storage = getStorage();
    const put = storage.put;
    storage.put = async () => {
      throw new Error("disk on fire");
    };
    try {
      const res = await admin.post("/api/admin/system/storage-test");
      assert.equal(res.body.ok, false);
      assert.equal(res.body.message, "disk on fire");
    } finally {
      storage.put = put;
    }
  });
});
