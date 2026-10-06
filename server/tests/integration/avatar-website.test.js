/**
 * "Learn from a website": an avatar is given a business's site and ends up with
 * a fact sheet in its knowledge base and, if asked, a brief written from it.
 * The site and Kie.ai's ChatGPT are stand-ins; the tests check what is read,
 * what is sent to the model, and what is kept.
 */
import "../setup-env.js";
import test, { after, afterEach, before, describe } from "node:test";
import assert from "node:assert/strict";
import { env } from "../../src/config/env.js";
import { KnowledgeDocument } from "../../src/models/index.js";
import { parseBriefing } from "../../src/modules/avatars/website.service.js";
import { parseHtml } from "../../src/integrations/web/siteReader.js";
import { signUp, startTestApp } from "../helpers.js";

let app;
const realFetch = globalThis.fetch;
const chatCalls = [];
const pageCalls = [];

const SITE = "http://127.0.0.1:9";
const html = (title, body, extra = "") =>
  new Response(
    `<html><head><title>${title}</title><meta name="description" content="Fresh bread daily"></head>` +
      `<body><nav><a href="/about">About</a><a href="/pricing">Pricing</a><a href="/login">Log in</a></nav>${body}${extra}</body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
const long = (s) => `<p>${s} ${"We bake with care every single morning. ".repeat(4)}</p>`;

const PAGES = {
  "/": () => html("Sunrise Bakery", long("Sunrise Bakery is a family bakery in Pune.") + '<a href="https://evil.example/x">out</a><script>steal()</script>'),
  "/about": () => html("About", long("Founded in 1999 by the Rao family.")),
  "/pricing": () => html("Pricing", long("A sourdough loaf costs 120 rupees.")),
  "/login": () => html("Login", long("Please sign in.")),
};

const BRIEFING = {
  businessName: "Sunrise Bakery",
  knowledge: "## About\nA family bakery in Pune, founded 1999.\n## Prices\nSourdough loaf: 120 rupees.",
  systemPrompt: "You speak for Sunrise Bakery. Answer from the fact sheet only.",
  greeting: "Hi, welcome to Sunrise Bakery!",
};
let model = () => ({ choices: [{ message: { role: "assistant", content: JSON.stringify(BRIEFING) } }] });

before(async () => {
  app = await startTestApp({ seed: false });
  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (address.startsWith("https://api.kie.ai/gpt-5-2")) {
      chatCalls.push({ url: address, body: JSON.parse(init.body), auth: init.headers.Authorization });
      const out = model();
      return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (address.startsWith(SITE)) {
      pageCalls.push(address);
      const page = PAGES[new URL(address).pathname];
      return page ? page() : new Response("nope", { status: 404 });
    }
    return realFetch(url, init);
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await app.stop();
});

afterEach(() => {
  chatCalls.length = 0;
  pageCalls.length = 0;
  env.kie.apiKey = "";
});

async function newAvatar(user) {
  const { body } = await user.post("/api/studio/stock", {
    providerId: "library",
    providerAvatarId: "face_f01",
    name: "Shop",
  });
  return body.avatar._id;
}

const learn = (user, id, payload) => user.post(`/api/avatars/${id}/website`, payload);

describe("POST /api/avatars/:id/website", () => {
  test("reads the site, asks ChatGPT, keeps a fact sheet and writes the brief", async () => {
    env.kie.apiKey = "test-key";
    const user = await signUp(app.baseUrl);
    const id = await newAvatar(user);

    const res = await learn(user, id, { url: `${SITE}/` });

    assert.equal(res.status, 201);
    assert.equal(res.body.document.name, "Website: 127.0.0.1");
    assert.deepEqual(res.body.brief, { systemPrompt: BRIEFING.systemPrompt, greeting: BRIEFING.greeting });
    assert.equal(res.body.pages.length, 3, "home, about and pricing - not the login page or another site");
    assert.ok(!pageCalls.some((u) => u.includes("login") || u.includes("evil")));

    // What the model was given: the site's words, marked as untrusted, nothing script-like.
    const [call] = chatCalls;
    assert.equal(call.auth, "Bearer test-key");
    const sent = JSON.stringify(call.body);
    assert.match(sent, /sourdough loaf costs 120 rupees/i);
    assert.match(sent, /untrusted/i);
    assert.ok(!sent.includes("steal()"));

    const doc = await KnowledgeDocument.findOne({ avatarId: id });
    assert.match(doc.text, /Sourdough loaf: 120 rupees/);

    const { body } = await user.get(`/api/avatars/${id}`);
    assert.equal(body.avatar.personaId.systemPrompt, BRIEFING.systemPrompt);
    assert.equal(body.avatar.personaId.greeting, BRIEFING.greeting);
  });

  test("leaves the avatar's own brief alone when asked to", async () => {
    env.kie.apiKey = "test-key";
    const user = await signUp(app.baseUrl);
    const id = await newAvatar(user);
    const before = (await user.get(`/api/avatars/${id}`)).body.avatar.personaId.systemPrompt;

    const res = await learn(user, id, { url: `${SITE}/`, applyBrief: false });

    assert.equal(res.status, 201);
    assert.equal(res.body.brief, undefined);
    assert.equal((await user.get(`/api/avatars/${id}`)).body.avatar.personaId.systemPrompt, before);
    assert.equal(await KnowledgeDocument.countDocuments({ avatarId: id }), 1);
  });

  test("learning the same site again refreshes its document", async () => {
    env.kie.apiKey = "test-key";
    const user = await signUp(app.baseUrl);
    const id = await newAvatar(user);
    await learn(user, id, { url: `${SITE}/` });
    model = () => ({
      choices: [{ message: { content: JSON.stringify({ ...BRIEFING, knowledge: "## About\nNow with a second shop in Mumbai, open daily." }) } }],
    });
    try {
      await learn(user, id, { url: `${SITE}/about` });
    } finally {
      model = () => ({ choices: [{ message: { role: "assistant", content: JSON.stringify(BRIEFING) } }] });
    }

    const docs = await KnowledgeDocument.find({ avatarId: id });
    assert.equal(docs.length, 1);
    assert.match(docs[0].text, /second shop in Mumbai/);
  });

  test("says so when no AI key is set up, and fetches nothing", async () => {
    const user = await signUp(app.baseUrl);
    const id = await newAvatar(user);
    const res = await learn(user, id, { url: `${SITE}/` });
    assert.equal(res.status, 503);
    assert.equal(chatCalls.length, 0);
  });

  test("refuses addresses that are not web pages, and sites that cannot be read", async () => {
    env.kie.apiKey = "test-key";
    const user = await signUp(app.baseUrl);
    const id = await newAvatar(user);

    assert.equal((await learn(user, id, { url: "ftp://example.com/x" })).status, 422);
    assert.equal((await learn(user, id, { url: `${SITE}/missing` })).status, 422);
    assert.equal((await learn(user, id, { url: "" })).status, 400);
    assert.equal(chatCalls.length, 0);
  });

  test("a model answer that is not usable is a 502, and nothing is kept", async () => {
    env.kie.apiKey = "test-key";
    const user = await signUp(app.baseUrl);
    const id = await newAvatar(user);
    model = () => ({ choices: [{ message: { content: "Sorry, I cannot help with that." } }] });
    try {
      assert.equal((await learn(user, id, { url: `${SITE}/` })).status, 502);
    } finally {
      model = () => ({ choices: [{ message: { role: "assistant", content: JSON.stringify(BRIEFING) } }] });
    }
    assert.equal(await KnowledgeDocument.countDocuments({ avatarId: id }), 0);
  });

  test("a rejected Kie key is a 503 an admin can act on", async () => {
    env.kie.apiKey = "bad";
    const user = await signUp(app.baseUrl);
    const id = await newAvatar(user);
    model = () => ({ code: 401, msg: "Unauthorized" });
    try {
      assert.equal((await learn(user, id, { url: `${SITE}/` })).status, 503);
    } finally {
      model = () => ({ choices: [{ message: { role: "assistant", content: JSON.stringify(BRIEFING) } }] });
    }
  });

  test("is for the avatar's own workspace, and needs sign-in", async () => {
    env.kie.apiKey = "test-key";
    const owner = await signUp(app.baseUrl);
    const stranger = await signUp(app.baseUrl);
    const id = await newAvatar(owner);

    assert.equal((await learn(stranger, id, { url: `${SITE}/` })).status, 404);
    const anon = await fetch(`${app.baseUrl}/api/avatars/${id}/website`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `${SITE}/` }),
    });
    assert.equal(anon.status, 401);
    assert.equal(pageCalls.length, 0);
  });
});

describe("reading and briefing helpers", () => {
  test("parseHtml keeps the words and drops scripts, menus and tags", () => {
    const page = parseHtml(
      '<title>A &amp; B</title><nav>Menu</nav><script>x()</script><h1>Hello</h1><p>Open 9&ndash;5</p><a href="/c">c</a>',
      new URL("https://shop.test/"),
    );
    assert.equal(page.title, "A & B");
    assert.match(page.body, /Hello/);
    assert.match(page.body, /Open 9-5/);
    assert.ok(!/Menu|x\(\)/.test(page.body));
    assert.equal(page.links[0].href, "https://shop.test/c");
  });

  test("parseBriefing copes with a code fence and refuses an empty fact sheet", () => {
    const fenced = "```json\n" + JSON.stringify(BRIEFING) + "\n```";
    assert.equal(parseBriefing(fenced).businessName, "Sunrise Bakery");
    assert.throws(() => parseBriefing(JSON.stringify({ ...BRIEFING, knowledge: "" })), { statusCode: 502 });
    assert.throws(() => parseBriefing("no json here"), { statusCode: 502 });
  });
});
