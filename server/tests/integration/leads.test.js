/**
 * Lead capture and human handoff: the tools an avatar gets when its owner
 * switches them on, what they store, and how the owner reviews and exports it.
 */
import "../setup-env.js";
import test, { after, afterEach, before, describe } from "node:test";
import assert from "node:assert/strict";
import { env } from "../../src/config/env.js";
import { Avatar, Conversation, Handoff, Lead } from "../../src/models/index.js";
import { buildCallTools } from "../../src/agent/callTools.js";
import { instructionsFor } from "../../src/agent/instructions.js";
import { signUp, startTestApp } from "../helpers.js";

let app;
let user;
const realFetch = globalThis.fetch;
const emails = [];
const saved = {};

before(async () => {
  app = await startTestApp({ seed: false });
  user = await signUp(app.baseUrl);
  Object.assign(saved, { key: env.mail.resendApiKey, from: env.mail.fromEmail });
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.resend.com")) {
      emails.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "mail-1" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(url, init);
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await app.stop();
});

afterEach(() => {
  emails.length = 0;
  env.mail.resendApiKey = saved.key;
  env.mail.fromEmail = saved.from;
});

async function newAvatar(persona = {}) {
  const { body } = await user.post("/api/studio/stock", {
    providerId: "library",
    providerAvatarId: "face_f01",
    name: "Receptionist",
    behaviour: persona,
  });
  return Avatar.findById(body.avatar._id).populate("personaId").lean();
}

async function callOn(avatar, guest) {
  return Conversation.create({
    workspaceId: avatar.workspaceId,
    avatarId: avatar._id,
    roomName: `room-${Math.random().toString(36).slice(2)}`,
    providerId: "mock",
    pipelineMode: "render-only",
    transport: "livekit",
    source: guest ? "link" : "app",
    ...(guest && { guest }),
  });
}

/** The tools exactly as the worker builds them, called the way the model would. */
async function tools(avatar, conversation) {
  const list = buildCallTools({ avatar: { ...avatar, persona: avatar.personaId }, conversation });
  return Object.fromEntries(list.map((t) => [t.name, (args) => t.execute(args, {})]));
}

describe("what a call is given", () => {
  test("nothing unless the owner switched it on", async () => {
    const avatar = await newAvatar({});
    const call = await callOn(avatar);
    assert.deepEqual(Object.keys(await tools(avatar, call)), []);
  });

  test("each tool separately, and the instructions explain it", async () => {
    const avatar = await newAvatar({ captureLeads: true });
    const call = await callOn(avatar);
    assert.deepEqual(Object.keys(await tools(avatar, call)), ["save_lead"]);
    assert.match(instructionsFor({ ...avatar, persona: avatar.personaId }), /save_lead/);

    const both = await newAvatar({ captureLeads: true, humanHandoff: true });
    assert.deepEqual(Object.keys(await tools(both, await callOn(both))).sort(), ["request_human", "save_lead"]);

    const off = await newAvatar({});
    assert.doesNotMatch(instructionsFor({ ...off, persona: off.personaId }), /save_lead|request_human/);
  });
});

describe("save_lead", () => {
  test("stores a structured lead tied to the avatar and the call", async () => {
    const avatar = await newAvatar({ captureLeads: true });
    const call = await callOn(avatar);
    const { save_lead } = await tools(avatar, call);

    const said = await save_lead({ name: "Priya Shah", email: "Priya@Example.com", phone: "+91 98765 43210", requirement: "Wants a quote for 20 licences" });

    assert.match(said, /Saved/);
    const lead = await Lead.findOne({ avatarId: avatar._id });
    assert.equal(lead.email, "priya@example.com");
    assert.equal(lead.phoneKey, "919876543210");
    assert.equal(lead.requirement, "Wants a quote for 20 licences");
    assert.equal(String(lead.workspaceId), String(avatar.workspaceId));
    assert.deepEqual(lead.conversationIds.map(String), [String(call._id)]);
  });

  test("the same person calling again is one lead with two calls, matched on email or on phone", async () => {
    const avatar = await newAvatar({ captureLeads: true });
    const first = await tools(avatar, await callOn(avatar));
    await first.save_lead({ name: "Sam", email: "sam@example.com" });

    const second = await tools(avatar, await callOn(avatar));
    assert.match(await second.save_lead({ email: "SAM@example.com", requirement: "Now wants a demo" }), /Updated/);

    const third = await tools(avatar, await callOn(avatar));
    await third.save_lead({ name: "Sam", phone: "98765-43210" });
    const fourth = await tools(avatar, await callOn(avatar));
    await fourth.save_lead({ phone: "(98765) 43210", requirement: "Call back evenings" });

    const leads = await Lead.find({ avatarId: avatar._id });
    assert.equal(leads.filter((l) => l.email === "sam@example.com").length, 1);
    const sam = leads.find((l) => l.email === "sam@example.com");
    assert.equal(sam.calls, 2);
    assert.equal(sam.requirement, "Now wants a demo");
    // The phone-only caller is matched to the phone-only lead, not duplicated.
    const phoneOnly = leads.filter((l) => l.phoneKey === "9876543210");
    assert.equal(phoneOnly.length, 1);
    assert.equal(phoneOnly[0].calls, 2);
  });

  test("tells the model what is missing instead of saving half a lead", async () => {
    const avatar = await newAvatar({ captureLeads: true });
    const { save_lead } = await tools(avatar, await callOn(avatar));

    assert.match(await save_lead({ name: "No contact" }), /email address or a phone number/);
    assert.match(await save_lead({ email: "not-an-email" }), /email address does not look right/);
    assert.match(await save_lead({ phone: "123" }), /phone number does not look right/);
    assert.equal(await Lead.countDocuments({ avatarId: avatar._id }), 0);
  });

  test("uses the name and email the share-link form already collected", async () => {
    const avatar = await newAvatar({ captureLeads: true });
    const call = await callOn(avatar, { name: "Dana", email: "dana@example.com" });
    const { save_lead } = await tools(avatar, call);

    await save_lead({ requirement: "Pricing for a small team" });

    const lead = await Lead.findOne({ avatarId: avatar._id });
    assert.equal(lead.email, "dana@example.com");
    assert.equal(lead.name, "Dana");
  });
});

describe("request_human", () => {
  test("is recorded first, then the owner is emailed", async () => {
    env.mail.resendApiKey = "resend-key";
    env.mail.fromEmail = "studio@example.com";
    const avatar = await newAvatar({ humanHandoff: true });
    const call = await callOn(avatar);
    const { request_human } = await tools(avatar, call);

    const said = await request_human({ name: "Lee", contact: "lee@example.com", reason: "Needs a refund approved", preferredTime: "after 5pm" });

    assert.match(said, /not a live transfer/);
    const handoff = await Handoff.findOne({ conversationId: call._id });
    assert.equal(handoff.reason, "Needs a refund approved");
    assert.equal(handoff.notified, true);
    assert.equal(emails.length, 1);
    assert.match(emails[0].text, /Needs a refund approved/);
    assert.match(emails[0].text, /lee@example.com/);
    assert.match(emails[0].text, new RegExp(`/conversations/${call._id}`));
  });

  test("is still recorded when email is not set up, and says so", async () => {
    env.mail.resendApiKey = "";
    const avatar = await newAvatar({ humanHandoff: true });
    const call = await callOn(avatar);
    const { request_human } = await tools(avatar, call);

    await request_human({ contact: "+91 98765 43210", reason: "Wants to talk pricing" });

    const handoff = await Handoff.findOne({ conversationId: call._id });
    assert.equal(handoff.notified, false);
    assert.match(handoff.notifyError, /not configured/i);
  });

  test("asking twice on one call is one request; a missing reason or contact is asked for", async () => {
    const avatar = await newAvatar({ humanHandoff: true });
    const call = await callOn(avatar);
    const { request_human } = await tools(avatar, call);

    assert.match(await request_human({ reason: "Help" }), /how the team can reach them/);
    assert.match(await request_human({ contact: "a@b.co" }), /what they need/);
    await request_human({ contact: "a@b.co", reason: "Help please" });
    await request_human({ contact: "a@b.co", reason: "Help please, again" });
    assert.equal(await Handoff.countDocuments({ conversationId: call._id }), 1);
  });
});

describe("the owner's view", () => {
  test("lists leads and requests, scoped to the workspace, and updates their status", async () => {
    const avatar = await newAvatar({ captureLeads: true, humanHandoff: true });
    const t = await tools(avatar, await callOn(avatar));
    await t.save_lead({ name: "Owner view", email: "ov@example.com" });
    await t.request_human({ contact: "ov@example.com", reason: "Talk" });

    const { body } = await user.get("/api/leads");
    const lead = body.leads.find((l) => l.email === "ov@example.com");
    assert.equal(lead.avatarName, "Receptionist");
    assert.equal(lead.phoneKey, undefined, "internals are not leaked");

    const updated = await user.patch(`/api/leads/${lead._id}`, { status: "contacted" });
    assert.equal(updated.body.lead.status, "contacted");
    assert.equal((await user.get("/api/leads?status=new")).body.leads.some((l) => l._id === lead._id), false);

    const handoffs = (await user.get("/api/leads/handoffs")).body.handoffs;
    assert.ok(handoffs.length >= 1);
    const done = await user.patch(`/api/leads/handoffs/${handoffs[0]._id}`, { status: "done" });
    assert.equal(done.body.handoff.status, "done");

    const stranger = await signUp(app.baseUrl);
    assert.deepEqual((await stranger.get("/api/leads")).body.leads, []);
    assert.equal((await stranger.patch(`/api/leads/${lead._id}`, { status: "closed" })).status, 404);
  });

  test("exports CSV, with spreadsheet formulas made harmless", async () => {
    const avatar = await newAvatar({ captureLeads: true });
    const t = await tools(avatar, await callOn(avatar));
    await t.save_lead({ name: "=HYPERLINK(\"http://evil\")", email: "csv@example.com", requirement: "Needs, a \"quote\"" });

    const res = await fetch(`${app.baseUrl}/api/leads/export.csv`, { headers: { authorization: `Bearer ${user.token}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    const csv = await res.text();
    assert.match(csv, /^"Name","Email"/);
    assert.match(csv, /"'=HYPERLINK/);
    assert.match(csv, /"Needs, a ""quote"""/);
  });
});
