/**
 * Testing an avatar in text before sharing it, and reading back what it knows.
 * The language models are stand-ins; the tests check what is sent to them and
 * what comes back.
 */
import "../setup-env.js";
import test, { after, afterEach, before, describe } from "node:test";
import assert from "node:assert/strict";
import { env } from "../../src/config/env.js";
import { Avatar, Conversation, KnowledgeDocument } from "../../src/models/index.js";
import { CONTEXT_BUDGET_CHARS } from "../../src/ai/knowledge.js";
import { signUp, startTestApp } from "../helpers.js";

let app;
let user;
const realFetch = globalThis.fetch;
const sent = { claude: [], kie: [] };
const saved = {};

before(async () => {
  app = await startTestApp({ seed: false });
  user = await signUp(app.baseUrl);
  Object.assign(saved, { anthropic: env.anthropicApiKey, kie: env.kie.apiKey });
  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (address.startsWith("https://api.anthropic.com")) {
      sent.claude.push({ headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "We open at nine." }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (address.startsWith("https://api.kie.ai/gpt-5-2")) {
      sent.kie.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "Stand-in answer." } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return realFetch(url, init);
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await app.stop();
});

afterEach(() => {
  sent.claude.length = 0;
  sent.kie.length = 0;
  env.anthropicApiKey = saved.anthropic;
  env.kie.apiKey = saved.kie;
});

async function newAvatar(persona = {}) {
  const { body } = await user.post("/api/studio/stock", {
    providerId: "library",
    providerAvatarId: "face_f01",
    name: "Tester",
    behaviour: { systemPrompt: "You speak for Sunrise Bakery.", ...persona },
  });
  return body.avatar._id;
}

const doc = async (avatarId, name, text, createdAt) => {
  const avatar = await Avatar.findById(avatarId).select("workspaceId").lean();
  return KnowledgeDocument.collection.insertOne({
    workspaceId: avatar.workspaceId,
    avatarId: avatar._id,
    name,
    text,
    chars: text.length,
    truncated: false,
    createdAt: createdAt || new Date(),
    updatedAt: new Date(),
  });
};

const ask = (id, payload) => user.post(`/api/avatars/${id}/test`, payload);

describe("POST /api/avatars/:id/test", () => {
  test("answers with the avatar's own instructions and knowledge, on Claude when it can", async () => {
    env.anthropicApiKey = "sk-test";
    const id = await newAvatar({ llmModel: "claude-sonnet-5", temperature: 0.3 });
    await doc(id, "Hours", "The bakery opens at 9am and closes at 5pm.");

    const res = await ask(id, { message: "When do you open?", history: [{ role: "user", text: "Hi" }, { role: "assistant", text: "Hello!" }] });

    assert.equal(res.status, 200);
    assert.equal(res.body.reply, "We open at nine.");
    assert.equal(res.body.model.exact, true);
    assert.equal(res.body.model.used, "claude-sonnet-5");

    const [call] = sent.claude;
    assert.equal(call.headers["x-api-key"], "sk-test");
    assert.equal(call.body.temperature, 0.3);
    assert.match(call.body.system, /You speak for Sunrise Bakery/);
    assert.match(call.body.system, /opens at 9am/);
    assert.deepEqual(
      call.body.messages.map((m) => [m.role, m.content]),
      [["user", "Hi"], ["assistant", "Hello!"], ["user", "When do you open?"]],
    );
  });

  test("a hosted model is answered by a stand-in, and says so", async () => {
    env.anthropicApiKey = "";
    env.kie.apiKey = "kie-key";
    const id = await newAvatar({ llmModel: "openai/gpt-5-mini" });
    await doc(id, "Prices", "A loaf costs 120 rupees.");

    const res = await ask(id, { message: "How much is a loaf?" });

    assert.equal(res.status, 200);
    assert.equal(res.body.reply, "Stand-in answer.");
    assert.equal(res.body.model.exact, false);
    assert.equal(res.body.model.intended, "openai/gpt-5-mini");
    assert.match(res.body.model.note, /stand-in/);
    assert.match(JSON.stringify(sent.kie[0]), /A loaf costs 120 rupees/);
  });

  test("starts no call and takes no credits", async () => {
    env.anthropicApiKey = "sk-test";
    const id = await newAvatar({ llmModel: "claude-sonnet-5" });
    // The first reads grant what the plan gives; measure after that has settled.
    await user.get("/api/billing/credits");
    const before = (await user.get("/api/billing/credits")).body;

    await ask(id, { message: "Hello?" });

    assert.equal(await Conversation.countDocuments({ avatarId: id }), 0);
    const after = (await user.get("/api/billing/credits")).body;
    assert.equal(after.balance, before.balance);
  });

  test("reports which documents fit what a call can carry", async () => {
    env.anthropicApiKey = "sk-test";
    const id = await newAvatar({ llmModel: "claude-sonnet-5" });
    await doc(id, "First", "a".repeat(CONTEXT_BUDGET_CHARS - 100), new Date(Date.now() - 3000));
    await doc(id, "Second", "b".repeat(500), new Date(Date.now() - 2000));
    await doc(id, "Third", "c".repeat(50), new Date(Date.now() - 1000));

    const { body } = await ask(id, { message: "Anything?" });
    assert.deepEqual(
      body.knowledge.documents.map((d) => [d.name, d.reachesCalls]),
      [["First", "full"], ["Second", "partial"], ["Third", "none"]],
    );

    const list = (await user.get(`/api/avatars/${id}/documents`)).body.documents;
    assert.deepEqual(list.map((d) => d.reachesCalls), ["full", "partial", "none"]);
  });

  test("says what is missing when no model can be reached", async () => {
    env.anthropicApiKey = "";
    env.kie.apiKey = "";
    const id = await newAvatar({});
    const res = await ask(id, { message: "Hello?" });
    assert.equal(res.status, 503);
    assert.match(res.body.error.message, /Kie|Anthropic/);
  });

  test("needs a message, and an avatar in the caller's workspace", async () => {
    env.anthropicApiKey = "sk-test";
    const id = await newAvatar({ llmModel: "claude-sonnet-5" });
    assert.equal((await ask(id, { message: "   " })).status, 400);

    const stranger = await signUp(app.baseUrl);
    assert.equal((await stranger.post(`/api/avatars/${id}/test`, { message: "Hi" })).status, 404);
    assert.equal(sent.claude.length, 0);
  });
});

describe("GET /api/avatars/:id/documents/:docId", () => {
  test("returns the stored text and whether it reaches calls", async () => {
    const id = await newAvatar({});
    await doc(id, "Policy", "Refunds within 14 days.");
    const [{ _id }] = (await user.get(`/api/avatars/${id}/documents`)).body.documents;

    const res = await user.get(`/api/avatars/${id}/documents/${_id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.document.text, "Refunds within 14 days.");
    assert.equal(res.body.document.reachesCalls, "full");

    const stranger = await signUp(app.baseUrl);
    assert.equal((await stranger.get(`/api/avatars/${id}/documents/${_id}`)).status, 404);
  });
});
