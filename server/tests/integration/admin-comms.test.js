/**
 * Admin comms: notifications and what users see of them, hero banners,
 * dashboard cards, email templates, lists, audience resolution and sending,
 * scheduled email, and the support mailbox.
 *
 * Nothing here sends real mail: the mail integration is replaced with a
 * recorder, and RESEND_API_KEY is blanked so "not configured" is testable.
 */
import "../setup-env.js";
import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { signUp, startTestApp } from "../helpers.js";
import { env } from "../../src/config/env.js";
import { setMailTransport, sendToRecipients } from "../../src/modules/comms/sender.js";
import { processDueScheduledEmails } from "../../src/modules/comms/scheduler.js";
import {
  AppNotification,
  EmailListMember,
  Plan,
  ScheduledEmail,
  Subscription,
  SupportEmail,
  User,
} from "../../src/models/index.js";

let app;
let admin;
let alice;
let bob;
let carol;

/** Every message the fake provider was asked to send. */
let outbox = [];
/** Addresses the fake provider refuses, to exercise per-recipient failures. */
let refuse = new Set();

const record = async (message) => {
  if (refuse.has(message.to)) return { ok: false, error: `rejected ${message.to}` };
  outbox.push(message);
  return { ok: true, id: `msg_${outbox.length}` };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idOf = async (email) => String((await User.findOne({ email }))._id);

before(async () => {
  env.mail.resendApiKey = "";
  env.mail.fromEmail = "";
  env.mail.inboundToken = "";

  app = await startTestApp({ seed: false });
  admin = await signUp(app.baseUrl, { email: "admin@example.com", name: "Admin" });
  alice = await signUp(app.baseUrl, { email: "alice@example.com", name: "Alice Smith" });
  bob = await signUp(app.baseUrl, { email: "bob@example.com", name: "Bob" });
  carol = await signUp(app.baseUrl, { email: "carol@example.com" });
});

beforeEach(() => {
  outbox = [];
  refuse = new Set();
  setMailTransport(record);
});

after(async () => {
  setMailTransport(null);
  await app.stop();
});

describe("access", () => {
  test("every admin comms route refuses non-admins and anonymous callers", async () => {
    for (const path of [
      "/api/admin/notifications",
      "/api/admin/hero-banners",
      "/api/admin/dashboard-cards",
      "/api/admin/mailing/templates",
      "/api/admin/mailing/lists",
      "/api/admin/mailing/scheduled",
      "/api/admin/support/emails",
    ]) {
      assert.equal((await alice.get(path)).status, 403, path);
      assert.equal((await fetch(`${app.baseUrl}${path}`)).status, 401, path);
    }
  });
});

describe("notifications", () => {
  const past = () => new Date(Date.now() - 60_000).toISOString();
  const make = (overrides) =>
    admin.post("/api/admin/notifications", {
      title: "Hello",
      message: "<p>Body</p>",
      status: "published",
      publishDate: past(),
      ...overrides,
    });

  before(async () => {
    await AppNotification.deleteMany({});
  });

  test("validates input", async () => {
    assert.equal((await admin.post("/api/admin/notifications", { title: "x" })).status, 400);
    assert.equal((await make({ message: "<p> </p>" })).status, 400);
    assert.equal((await make({ linkUrl: "javascript:alert(1)" })).status, 400);
    assert.equal((await make({ icon: "NotAnIcon" })).status, 400);
    assert.equal((await make({ targetRoles: [] })).status, 400);
  });

  test("stores the publish date exactly and strips scripts from the message", async () => {
    const when = "2026-03-04T05:06:07.000Z";
    const { status, body } = await make({
      title: "Dated",
      status: "draft",
      publishDate: when,
      message: '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>',
    });
    assert.equal(status, 201);
    assert.equal(new Date(body.notification.publishDate).toISOString(), when);
    assert.ok(!/script|onclick|javascript:/i.test(body.notification.message), body.notification.message);
    assert.match(body.notification.message, /Hi/);

    const patched = await admin.patch(`/api/admin/notifications/${body.notification._id}`, { title: "Renamed" });
    assert.equal(new Date(patched.body.notification.publishDate).toISOString(), when, "an edit keeps the date");
  });

  test("shows a user only what is published, due and aimed at their role", async () => {
    await AppNotification.deleteMany({});
    await make({ title: "for everyone" });
    await make({ title: "users only", targetRoles: ["user"] });
    await make({ title: "admins only", targetRoles: ["admin"] });
    await make({ title: "a draft", status: "draft" });
    await make({ title: "archived", status: "archived" });
    await make({ title: "not yet", publishDate: new Date(Date.now() + 3_600_000).toISOString() });

    const titles = async (who) => (await who.get("/api/site/notifications")).body.notifications.map((n) => n.title).sort();
    assert.deepEqual(await titles(alice), ["for everyone", "users only"]);
    assert.deepEqual(await titles(admin), ["admins only", "for everyone"]);

    assert.equal((await fetch(`${app.baseUrl}/api/site/notifications`)).status, 401);
  });

  test("tracks what is new through lastCheckAt, and offers a popup once", async () => {
    await AppNotification.deleteMany({});
    await make({ title: "bell", displayType: "bell_only" });
    await make({ title: "popup", displayType: "popup_and_bell" });

    // Never looked: everything is new.
    let summary = (await bob.get("/api/site/notifications/summary")).body;
    assert.equal(summary.unreadCount, 2);
    assert.equal(summary.popup.title, "popup");

    // Opening the list reports newness from *before* the visit...
    const list = (await bob.get("/api/site/notifications")).body;
    assert.equal(list.lastCheckAt, null);
    assert.ok(list.notifications.every((n) => n.isNew));

    // ...and marking seen clears the badge and the popup.
    const seen = await bob.post("/api/site/notifications/seen");
    assert.equal(seen.status, 200);
    summary = (await bob.get("/api/site/notifications/summary")).body;
    assert.equal(summary.unreadCount, 0);
    assert.equal(summary.popup, null);

    const after = (await bob.get("/api/site/notifications")).body;
    assert.ok(after.lastCheckAt);
    assert.ok(after.notifications.every((n) => !n.isNew));

    // Something published later is new again; another user's state is untouched.
    await sleep(15);
    await admin.post("/api/admin/notifications", { title: "later", message: "<p>x</p>", status: "published" });
    assert.equal((await bob.get("/api/site/notifications/summary")).body.unreadCount, 1);
    assert.equal((await carol.get("/api/site/notifications/summary")).body.unreadCount, 3);
  });

  test("updates and deletes", async () => {
    const { body } = await make({ title: "to delete" });
    const id = body.notification._id;
    assert.equal((await admin.patch(`/api/admin/notifications/${id}`, { status: "archived" })).body.notification.status, "archived");
    assert.equal((await admin.del(`/api/admin/notifications/${id}`)).status, 200);
    assert.equal((await admin.del(`/api/admin/notifications/${id}`)).status, 404);
  });
});

describe("hero banners and dashboard cards", () => {
  test("serves active banners to signed-in users in display order", async () => {
    const make = (title, displayOrder, isActive = true) =>
      admin.post("/api/admin/hero-banners", { title, subtitle: "sub", displayOrder, isActive });
    await make("third", 5);
    await make("first", 1);
    await make("hidden", 0, false);
    await make("second", 3);

    const titles = (await alice.get("/api/site/hero-banners")).body.banners.map((b) => b.title);
    assert.deepEqual(titles, ["first", "second", "third"]);

    const all = (await admin.get("/api/admin/hero-banners")).body.banners;
    assert.equal(all.length, 4);
    assert.equal(all[0].title, "hidden", "the admin list is in display order and includes inactive banners");
  });

  test("requires a title and subtitle, and only safe links", async () => {
    assert.equal((await admin.post("/api/admin/hero-banners", { title: "x" })).status, 400);
    assert.equal((await admin.post("/api/admin/hero-banners", { title: "x", subtitle: "y", ctaLink: "javascript:alert(1)" })).status, 400);
    const ok = await admin.post("/api/admin/hero-banners", { title: "x", subtitle: "y", ctaLink: "/studio", walkthroughVideoUrl: "https://youtu.be/abcdefghijk" });
    assert.equal(ok.status, 201);
  });

  test("toggles a banner off", async () => {
    const { body } = await admin.post("/api/admin/hero-banners", { title: "toggle", subtitle: "s" });
    await admin.patch(`/api/admin/hero-banners/${body.banner._id}`, { isActive: false });
    const titles = (await alice.get("/api/site/hero-banners")).body.banners.map((b) => b.title);
    assert.ok(!titles.includes("toggle"));
  });

  test("manages dashboard cards but never serves them to end users", async () => {
    const created = await admin.post("/api/admin/dashboard-cards", {
      title: "Studio",
      description: "Make an avatar",
      targetPage: "Studio",
      isFeatureSection: true,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.card.accentColor, "accent-blue");
    assert.equal(created.body.card.iconName, "Sparkles");

    const list = (await admin.get("/api/admin/dashboard-cards")).body.cards;
    assert.equal(list.length, 1);
    assert.equal((await admin.del(`/api/admin/dashboard-cards/${created.body.card._id}`)).status, 200);
    assert.equal((await alice.get("/api/site/dashboard-cards")).status, 404);
  });

  test("rejects uploads of the wrong type or size", async () => {
    const send = (type, bytes, folder = "hero-banners") => {
      const form = new FormData();
      form.append("folder", folder);
      form.append("file", new Blob([Buffer.alloc(bytes)], { type }), "f.bin");
      return admin.upload("/api/admin/uploads", form);
    };

    assert.equal((await send("image/svg+xml", 10)).status, 400);
    assert.equal((await send("application/pdf", 10)).status, 400);
    assert.equal((await send("image/png", 11 * 1024 * 1024)).status, 413);
    assert.equal((await send("image/png", 10, "elsewhere")).status, 400);

    const ok = await send("image/png", 100);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.kind, "image");
    assert.match(ok.body.url, /\/uploads\/site\/hero-banners\/[\w-]+\.png$/);
  });
});

describe("email templates", () => {
  test("seeds the system templates once, branded from config rather than a hard-coded name", async () => {
    const first = (await admin.get("/api/admin/mailing/templates")).body.templates;
    const types = first.map((t) => t.templateType).sort();
    assert.deepEqual(types, [
      "forgot_password",
      "invitation_email",
      "plan_activated",
      "plan_updated",
      "subscription_cancelled",
      "welcome_email",
    ]);
    assert.ok(first.every((t) => t.isSystemTemplate && t.isActive));
    assert.ok(first.every((t) => !/cinema|clips|superclips|hooked/i.test(t.htmlBody + t.subject)));

    const second = (await admin.get("/api/admin/mailing/templates")).body.templates;
    assert.equal(second.length, first.length, "listing again does not add duplicates");
  });

  test("creates, validates and edits a custom template", async () => {
    assert.equal((await admin.post("/api/admin/mailing/templates", { name: "x" })).status, 400);
    assert.equal((await admin.post("/api/admin/mailing/templates", { name: "x", subject: "s", htmlBody: "<p>b</p>", templateType: "bogus" })).status, 400);

    const { status, body } = await admin.post("/api/admin/mailing/templates", {
      name: "Webinar",
      subject: "Join us",
      htmlBody: "<p>Hi {{userName}}</p>",
      templateType: "training_webinar",
    });
    assert.equal(status, 201);
    assert.equal(body.template.isSystemTemplate, false);

    const toggled = await admin.patch(`/api/admin/mailing/templates/${body.template._id}`, { isSystemTemplate: true });
    assert.equal(toggled.body.template.isSystemTemplate, true);
  });

  test("sends a test with example values filled in", async () => {
    const templates = (await admin.get("/api/admin/mailing/templates")).body.templates;
    const welcome = templates.find((t) => t.templateType === "welcome_email");

    const res = await admin.post(`/api/admin/mailing/templates/${welcome._id}/test`, { to: "qa@example.com" });
    assert.equal(res.status, 200);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, "qa@example.com");
    assert.match(outbox[0].html, /Welcome, Test User!/);
    assert.ok(!/\{\{/.test(outbox[0].html + outbox[0].subject + outbox[0].text), "no placeholder is left unfilled");
  });

  test("says so when email is not configured", async () => {
    setMailTransport(null);
    const res = await admin.post("/api/admin/mailing/test", { to: "qa@example.com", subject: "s", html: "<p>b</p>" });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.message, "Email is not configured on this server");
  });
});

describe("email lists", () => {
  let list;

  test("creates and edits a list, validating the name", async () => {
    assert.equal((await admin.post("/api/admin/mailing/lists", { description: "x" })).status, 400);
    const res = await admin.post("/api/admin/mailing/lists", { name: "Newsletter", description: "Weekly" });
    assert.equal(res.status, 201);
    list = res.body.list;
    assert.equal(list.isActive, true);

    const edited = await admin.patch(`/api/admin/mailing/lists/${list._id}`, { name: "Newsletter!" });
    assert.equal(edited.body.list.name, "Newsletter!");
  });

  test("adds members with validation, a duplicate check and a user lookup", async () => {
    const add = (email, fullName) => admin.post(`/api/admin/mailing/lists/${list._id}/members`, { email, fullName });

    assert.equal((await add("not-an-email")).status, 400);

    const registered = await add("Alice@Example.com", "typed name");
    assert.equal(registered.status, 201);
    assert.equal(registered.body.member.email, "alice@example.com", "lowercased");
    assert.equal(registered.body.member.fullName, "Alice Smith", "a registered user's own name wins");
    assert.ok(registered.body.member.userId);

    const outsider = await add("outsider@example.net", "Olive");
    assert.equal(outsider.body.member.userId, undefined);

    const dupe = await add("ALICE@example.com");
    assert.equal(dupe.status, 409);
    assert.equal(dupe.body.error.message, "This email is already in the list");
  });

  test("counts only active members, for every list in one request", async () => {
    const other = (await admin.post("/api/admin/mailing/lists", { name: "Empty" })).body.list;
    await EmailListMember.updateOne({ listId: list._id, email: "outsider@example.net" }, { status: "unsubscribed" });

    const lists = (await admin.get("/api/admin/mailing/lists")).body.lists;
    assert.equal(lists.find((l) => l._id === list._id).memberCount, 1);
    assert.equal(lists.find((l) => l._id === other._id).memberCount, 0);

    const members = (await admin.get(`/api/admin/mailing/lists/${list._id}/members`)).body.members;
    assert.equal(members.length, 2, "the members dialog shows every status");
  });

  test("exports CSV and neutralises spreadsheet formulas", async () => {
    await admin.post(`/api/admin/mailing/lists/${list._id}/members`, { email: "+cmd@example.org", fullName: '=HYPERLINK("http://evil")' });
    const { status, body } = await admin.get(`/api/admin/mailing/lists/${list._id}/export`);

    assert.equal(status, 200);
    assert.match(body.filename, /^Newsletter_\d{4}-\d\d-\d\d\.csv$/);
    const lines = body.csv.split("\n");
    assert.equal(lines[0], '"Email","Full Name","Status","Created Date"');
    assert.ok(lines.some((l) => l.startsWith(`"'+cmd@example.org","'=HYPERLINK(""http://evil"")"`)), body.csv);
    assert.ok(!lines.some((l) => /^"[=+\-@]/.test(l)), "no cell starts with a formula character");
  });

  test("deleting a list removes its members", async () => {
    assert.equal((await admin.del(`/api/admin/mailing/lists/${list._id}`)).status, 200);
    assert.equal(await EmailListMember.countDocuments({ listId: list._id }), 0);
    assert.equal((await admin.del(`/api/admin/mailing/lists/${list._id}`)).status, 404);
  });

  test("removes a single member", async () => {
    const l = (await admin.post("/api/admin/mailing/lists", { name: "Tmp" })).body.list;
    const m = (await admin.post(`/api/admin/mailing/lists/${l._id}/members`, { email: "tmp@example.net" })).body.member;
    assert.equal((await admin.del(`/api/admin/mailing/lists/${l._id}/members/${m._id}`)).status, 200);
    assert.equal((await admin.del(`/api/admin/mailing/lists/${l._id}/members/${m._id}`)).status, 404);
  });
});

describe("audience and bulk sending", () => {
  const msg = { subject: "Hi {{userName}}", html: "<p>Plan: {{planName}} for {{userEmail}}</p>" };
  const bulk = (audience, extra = {}) => admin.post("/api/admin/mailing/bulk", { audience, ...msg, ...extra });
  let proPlan;

  before(async () => {
    proPlan = await Plan.create({ key: "pro-test", name: "Pro", includedMinutes: 600 });
    const bobUser = await User.findOne({ email: "bob@example.com" });
    await Subscription.updateOne({ workspaceId: bobUser.workspaceId }, { planId: proPlan._id });
    await User.updateOne({ email: "carol@example.com" }, { blockedAt: new Date() });
  });

  test("sends one message per recipient and fills placeholders, with the real counts", async () => {
    const res = await bulk({ mode: "selected_users", userIds: [await idOf("alice@example.com"), await idOf("bob@example.com")] });

    assert.equal(res.status, 200);
    assert.deepEqual({ total: res.body.total, sent: res.body.sent, failed: res.body.failed }, { total: 2, sent: 2, failed: 0 });
    assert.deepEqual(outbox.map((m) => m.to).sort(), ["alice@example.com", "bob@example.com"]);
    assert.ok(outbox.every((m) => typeof m.to === "string"), "never a shared recipient list");

    const alice1 = outbox.find((m) => m.to === "alice@example.com");
    assert.equal(alice1.subject, "Hi Alice Smith");
    assert.match(alice1.html, /Plan: Free for alice@example\.com/);
    assert.match(outbox.find((m) => m.to === "bob@example.com").html, /Plan: Pro/);
    assert.match(alice1.text, /Plan: Free for alice@example\.com/, "plain text is derived from the HTML");
  });

  test("a name without one falls back to the address's local part, and markup in data is escaped", async () => {
    await User.updateOne({ email: "carol@example.com" }, { name: "<b>Carol</b>" });
    await bulk({ mode: "selected_users", userIds: [await idOf("carol@example.com")] }, { subject: "{{userName}}", html: "<p>{{userName}}</p>" });
    assert.match(outbox[0].html, /&lt;b&gt;Carol&lt;\/b&gt;/);
    await User.updateOne({ email: "carol@example.com" }, { $unset: { name: 1 } });

    outbox = [];
    await bulk({ mode: "selected_users", userIds: [await idOf("carol@example.com")] }, { subject: "Hi {{userName}}" });
    assert.equal(outbox[0].subject, "Hi carol");
  });

  test("counts failed recipients and carries on", async () => {
    refuse.add("bob@example.com");
    const res = await bulk({ mode: "selected_users", userIds: [await idOf("alice@example.com"), await idOf("bob@example.com")] });

    assert.equal(res.status, 200);
    assert.equal(res.body.sent, 1);
    assert.equal(res.body.failed, 1);
    assert.deepEqual(res.body.errors, [{ email: "bob@example.com", error: "rejected bob@example.com" }]);
  });

  test("resolves audiences on the server from criteria", async () => {
    const count = async (audience) => (await admin.post("/api/admin/mailing/audience", { audience })).body.count;

    assert.equal(await count({ mode: "all" }), 4);
    assert.equal(await count({ mode: "all", status: "suspended" }), 1);
    assert.equal(await count({ mode: "all", status: "active" }), 3);
    assert.equal(await count({ mode: "plans", planIds: [String(proPlan._id)] }), 1);
    assert.equal(await count({ mode: "plans", planIds: [String(proPlan._id)], planMode: "without" }), 3);
    assert.equal(await count({ mode: "selected_users", userIds: [] }), 0);
    assert.equal(await count({ mode: "lists", listIds: [] }), 0);
  });

  test("audiences from lists use active members of active lists, and skip bounced addresses", async () => {
    const l = (await admin.post("/api/admin/mailing/lists", { name: "Audience" })).body.list;
    const add = (email) => admin.post(`/api/admin/mailing/lists/${l._id}/members`, { email });
    await add("one@example.net");
    await add("two@example.net");
    await add("three@example.net");
    await EmailListMember.updateOne({ listId: l._id, email: "two@example.net" }, { status: "unsubscribed" });
    await EmailListMember.updateOne({ listId: l._id, email: "three@example.net" }, { status: "bounced" });

    await bulk({ mode: "lists", listIds: [l._id] });
    assert.deepEqual(outbox.map((m) => m.to), ["one@example.net"]);

    // Bounced elsewhere also excludes the address from other audiences.
    const other = (await admin.post("/api/admin/mailing/lists", { name: "Other" })).body.list;
    await admin.post(`/api/admin/mailing/lists/${other._id}/members`, { email: "three@example.net" });
    await admin.patch(`/api/admin/mailing/lists/${l._id}`, { isActive: false });
    outbox = [];
    assert.equal((await bulk({ mode: "lists", listIds: [l._id] })).status, 400, "an inactive list reaches nobody");
  });

  test("refuses a client-supplied recipient list, an empty audience and an unconfigured server", async () => {
    const injected = await admin.post("/api/admin/mailing/bulk", { audience: { mode: "all" }, recipients: ["victim@example.org"], ...msg });
    assert.equal(injected.status, 400);
    assert.equal(outbox.length, 0);

    const empty = await bulk({ mode: "selected_users", userIds: [] });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.message, "No recipients selected");

    setMailTransport(null);
    const unconfigured = await bulk({ mode: "all" });
    assert.equal(unconfigured.status, 503);
    assert.equal(unconfigured.body.error.message, "Email is not configured on this server");
  });

  test("sends in batches of ten", async () => {
    let inFlight = 0;
    let peak = 0;
    let calls = 0;
    setMailTransport(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight -= 1;
      calls += 1;
      return { ok: true, id: "x" };
    });

    const recipients = Array.from({ length: 25 }, (_, i) => ({ email: `r${i}@example.net` }));
    const started = Date.now();
    const result = await sendToRecipients({ recipients, subject: "s", html: "<p>b</p>", pauseMs: 40 });

    assert.equal(calls, 25);
    assert.equal(peak, 10, "ten at a time");
    assert.deepEqual({ total: result.total, sent: result.sent, failed: result.failed }, { total: 25, sent: 25, failed: 0 });
    assert.ok(Date.now() - started >= 80, "a pause between each batch");
  });

  test("test sends use the same placeholder rules", async () => {
    const res = await admin.post("/api/admin/mailing/test", { to: "qa@example.com", subject: "{{userName}} / {{planName}}", html: "<p>{{minutes}}</p>" });
    assert.equal(res.status, 200);
    assert.equal(outbox[0].subject, "Test User / Pro");
    assert.match(outbox[0].html, /<p>600<\/p>/);
  });
});

describe("scheduled email", () => {
  const schedule = (overrides = {}) =>
    admin.post("/api/admin/mailing/scheduled", {
      title: "Launch",
      subject: "Hello {{userName}}",
      fromName: "Team",
      htmlBody: "<p>News</p>",
      scheduledDate: new Date(Date.now() - 1000).toISOString(),
      audience: { mode: "selected_users", userIds: [], planMode: "with" },
      ...overrides,
    });
  const forAlice = async () => ({ mode: "selected_users", userIds: [await idOf("alice@example.com"), await idOf("bob@example.com")] });

  beforeEach(async () => {
    await ScheduledEmail.deleteMany({});
  });

  test("validates the form", async () => {
    assert.equal((await schedule({ title: "" })).status, 400);
    assert.equal((await schedule({ scheduledDate: "tomorrow" })).status, 400);
    assert.equal((await schedule({ audience: { mode: "everyone" } })).status, 400);
  });

  test("sends what is due, records the counts, and leaves the future alone", async () => {
    const due = (await schedule({ audience: await forAlice() })).body.email;
    const later = (await schedule({ title: "Later", audience: await forAlice(), scheduledDate: new Date(Date.now() + 3_600_000).toISOString() })).body.email;

    const run = await processDueScheduledEmails({ pauseMs: 0 });
    assert.equal(run.processed, 1);
    assert.deepEqual(outbox.map((m) => m.to).sort(), ["alice@example.com", "bob@example.com"]);
    assert.equal(outbox.find((m) => m.to === "bob@example.com").subject, "Hello Bob");

    const sent = await ScheduledEmail.findById(due._id).lean();
    assert.equal(sent.status, "sent");
    assert.equal(sent.sentCount, 2);
    assert.equal(sent.failedCount, 0);
    assert.ok(sent.sentDate);
    assert.equal((await ScheduledEmail.findById(later._id).lean()).status, "pending");
  });

  test("two instances ticking together never send the same email twice", async () => {
    await schedule({ audience: await forAlice() });
    const results = await Promise.all([
      processDueScheduledEmails({ pauseMs: 0 }),
      processDueScheduledEmails({ pauseMs: 0 }),
      processDueScheduledEmails({ pauseMs: 0 }),
    ]);

    assert.equal(results.reduce((n, r) => n + r.processed, 0), 1);
    assert.equal(outbox.length, 2, "two recipients, once each");
    assert.equal(await ScheduledEmail.countDocuments({ status: "sent" }), 1);
  });

  test("records failures, and fails the email when nothing went out", async () => {
    refuse.add("bob@example.com");
    await schedule({ audience: await forAlice() });
    await processDueScheduledEmails({ pauseMs: 0 });
    const partial = await ScheduledEmail.findOne().lean();
    assert.equal(partial.status, "sent");
    assert.equal(partial.sentCount, 1);
    assert.equal(partial.failedCount, 1);

    await ScheduledEmail.deleteMany({});
    refuse = new Set(["alice@example.com", "bob@example.com"]);
    await schedule({ audience: await forAlice() });
    await processDueScheduledEmails({ pauseMs: 0 });
    const failed = await ScheduledEmail.findOne().lean();
    assert.equal(failed.status, "failed");
    assert.match(failed.errorMessage, /rejected/);
  });

  test("leaves emails pending, not failed, while mail is not configured", async () => {
    await schedule({ audience: await forAlice() });
    setMailTransport(null);

    const run = await processDueScheduledEmails({ pauseMs: 0 });
    assert.equal(run.processed, 0);
    assert.equal(run.skipped, "Email is not configured on this server");
    assert.equal((await ScheduledEmail.findOne().lean()).status, "pending");

    const manual = await admin.post("/api/admin/mailing/scheduled/run");
    assert.equal(manual.status, 503);
  });

  test("cancels a pending email, and a cancelled one is never sent", async () => {
    const { _id } = (await schedule({ audience: await forAlice() })).body.email;
    assert.equal((await admin.post(`/api/admin/mailing/scheduled/${_id}/cancel`)).body.email.status, "cancelled");
    assert.equal((await admin.post(`/api/admin/mailing/scheduled/${_id}/cancel`)).status, 409);

    await processDueScheduledEmails({ pauseMs: 0 });
    assert.equal(outbox.length, 0);
  });

  test("lists pending emails with their recipient counts, and deletes", async () => {
    const { _id } = (await schedule({ audience: await forAlice(), scheduledDate: new Date(Date.now() + 3_600_000).toISOString() })).body.email;
    const listed = (await admin.get("/api/admin/mailing/scheduled")).body.emails;
    assert.equal(listed[0].recipientCount, 2);

    assert.equal((await admin.del(`/api/admin/mailing/scheduled/${_id}`)).status, 200);
    assert.equal((await admin.get("/api/admin/mailing/scheduled")).body.emails.length, 0);
  });

  test("the run-now endpoint processes what is due", async () => {
    await schedule({ audience: { mode: "selected_users", userIds: [await idOf("alice@example.com")] } });
    const res = await admin.post("/api/admin/mailing/scheduled/run");
    assert.equal(res.status, 200);
    assert.equal(res.body.processed, 1);
    assert.equal(outbox.length, 1);
  });

  test("reports the figures the Mailing header shows", async () => {
    const stats = (await admin.get("/api/admin/mailing/stats")).body;
    assert.equal(typeof stats.emailLists, "number");
    assert.ok(stats.emailTemplates >= 6);
    assert.equal(stats.mailConfigured, true);
  });
});

describe("support mailbox", () => {
  const inbound = (payload, token = "s3cret") =>
    fetch(`${app.baseUrl}/api/inbound/email${token === null ? "" : `?token=${token}`}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  const payload = (over = {}) => ({
    type: "email.received",
    data: {
      from: '"Pat Customer" <pat@example.org>',
      to: ["support@example.com"],
      subject: "Help me",
      text: "Where is my avatar?",
      html: "<p>Where is my <b>avatar</b>?</p><script>alert(1)</script>",
      message_id: "<m1@example.org>",
      ...over,
    },
  });

  before(async () => {
    await SupportEmail.deleteMany({});
  });

  test("is switched off until a shared secret is configured", async () => {
    env.mail.inboundToken = "";
    const res = await inbound(payload(), "anything");
    assert.equal(res.status, 503);
    assert.equal(await SupportEmail.countDocuments(), 0);
  });

  test("rejects a missing or wrong token", async () => {
    env.mail.inboundToken = "s3cret";
    assert.equal((await inbound(payload(), null)).status, 401);
    assert.equal((await inbound(payload(), "nope")).status, 401);
    assert.equal(await SupportEmail.countDocuments(), 0);
  });

  test("stores an inbound email, parsing the sender and sanitising its HTML", async () => {
    const res = await inbound(payload());
    assert.equal(res.status, 200);

    const stored = await SupportEmail.findOne().lean();
    assert.equal(stored.fromEmail, "pat@example.org");
    assert.equal(stored.fromName, "Pat Customer");
    assert.equal(stored.toEmail, "support@example.com");
    assert.equal(stored.status, "unread");
    assert.equal(stored.direction, "inbound");
    assert.equal(stored.threadId, "<m1@example.org>");
    assert.ok(!/script/i.test(stored.htmlBody));
    assert.match(stored.htmlBody, /avatar/);
  });

  test("dedupes a delivery the provider repeats", async () => {
    const res = await inbound(payload());
    assert.equal((await res.json()).deduped, true);
    assert.equal(await SupportEmail.countDocuments(), 1);
  });

  test("threads a reply under the message it answers", async () => {
    await inbound(payload({ message_id: "<m2@example.org>", subject: "Re: Help me", in_reply_to: "<m1@example.org>" }));
    await inbound(payload({ message_id: "<m3@example.org>", subject: "Other", headers: [{ name: "Message-ID", value: "<m3@example.org>" }] }));
    const [first, reply, other] = await SupportEmail.find().sort({ createdAt: 1 }).lean();
    assert.equal(reply.threadId, first.threadId);
    assert.notEqual(other.threadId, first.threadId);
  });

  test("lists, marks read, and archives for admins only", async () => {
    const emails = (await admin.get("/api/admin/support/emails")).body.emails;
    assert.equal(emails.length, 3);
    const target = emails.find((e) => e.subject === "Help me");

    assert.equal((await admin.patch(`/api/admin/support/emails/${target._id}`, { status: "read" })).body.email.status, "read");
    assert.equal((await admin.patch(`/api/admin/support/emails/${target._id}`, { status: "replied" })).status, 400, "replied is set by replying");
    assert.equal((await admin.patch(`/api/admin/support/emails/${target._id}`, { status: "archived" })).body.email.status, "archived");
    assert.equal((await alice.patch(`/api/admin/support/emails/${target._id}`, { status: "read" })).status, 403);
  });

  test("replies with a Re: subject, keeps the thread, and marks the original replied", async () => {
    const original = await SupportEmail.findOne({ subject: "Other" }).lean();
    const res = await admin.post(`/api/admin/support/emails/${original._id}/reply`, { text: "It is <ready>\nenjoy" });

    assert.equal(res.status, 200);
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].to, "pat@example.org");
    assert.equal(outbox[0].subject, "Re: Other");
    assert.match(outbox[0].html, /It is &lt;ready&gt;<br\/>enjoy/, "typed text is escaped");

    const copy = await SupportEmail.findOne({ direction: "outbound" }).lean();
    assert.equal(copy.threadId, original.threadId);
    assert.equal(copy.inReplyTo, original.messageId);
    assert.equal(copy.repliedBy, "admin@example.com");
    assert.equal((await SupportEmail.findById(original._id).lean()).status, "replied");
  });

  test("does not double the Re: prefix, and refuses to reply when mail is not configured", async () => {
    const reply = await SupportEmail.findOne({ subject: "Re: Help me" }).lean();
    await admin.post(`/api/admin/support/emails/${reply._id}/reply`, { text: "ok" });
    assert.equal(outbox[0].subject, "Re: Help me");

    setMailTransport(null);
    const res = await admin.post(`/api/admin/support/emails/${reply._id}/reply`, { text: "again" });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.message, "Email is not configured on this server");
  });

  test("composes a new email and deletes", async () => {
    const res = await admin.post("/api/admin/support/emails", { to: "new@example.org", subject: "Hello", body: "Hi there" });
    assert.equal(res.status, 201);
    assert.equal(outbox.at(-1).to, "new@example.org");
    assert.equal(res.body.email.direction, "outbound");
    assert.equal(res.body.email.status, "replied");

    assert.equal((await admin.del(`/api/admin/support/emails/${res.body.email._id}`)).status, 200);
    assert.equal((await admin.del(`/api/admin/support/emails/${res.body.email._id}`)).status, 404);
  });
});
