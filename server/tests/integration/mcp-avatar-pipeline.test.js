/**
 * An avatar built, trained, voiced, updated and deployed entirely through the
 * MCP tools - no web UI. The website, Kie.ai (pictures and ChatGPT) and
 * ElevenLabs are stand-ins; the tests check what each tool does with them.
 */
import "../setup-env.js";
import test, { after, afterEach, before, describe } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env } from "../../src/config/env.js";
import { KnowledgeDocument } from "../../src/models/index.js";
import { signUp, startTestApp } from "../helpers.js";

process.env.MCP_FACE_POLL_MS = "5";

let app;
let client;
let stranger;
const realFetch = globalThis.fetch;
const FACE = Buffer.alloc(20_000, 3);
const SITE = "http://127.0.0.1:9";
const seen = { kie: [], eleven: [] };

const page = (title, body) =>
  new Response(`<html><head><title>${title}</title></head><body>${body}</body></html>`, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
const long = (s) => `<p>${s} ${"We look after every customer personally. ".repeat(4)}</p>`;
const SITES = {
  "/": () => page("Bright Dental", long("Bright Dental is a dental clinic in Delhi open Monday to Saturday.")),
  "/pricing": () => page("Pricing", long("A check-up costs 500 rupees.")),
};
const BRIEFING = {
  businessName: "Bright Dental",
  knowledge: "## About\nA dental clinic in Delhi, open Monday to Saturday.\n## Prices\nCheck-up: 500 rupees.",
  systemPrompt: "You speak for Bright Dental and answer from its fact sheet.",
  greeting: "Hello, this is Bright Dental!",
};
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

before(async () => {
  app = await startTestApp({ seed: false });
  const user = await signUp(app.baseUrl);
  stranger = await signUp(app.baseUrl);
  const { body } = await user.post("/api/api-keys", { name: "ChatGPT" });
  client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${app.baseUrl}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${body.key.key}` } },
    }),
  );

  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (address.startsWith("https://api.kie.ai")) {
      seen.kie.push(address);
      if (address.includes("gpt-5-2")) return json({ choices: [{ message: { content: JSON.stringify(BRIEFING) } }] });
      if (address.includes("record-info")) {
        return json({ code: 200, data: { successFlag: 1, response: { resultImageUrl: "https://result.kie.test/face.jpg" } } });
      }
      return json({ code: 200, data: { taskId: "face-1" } });
    }
    if (address.startsWith("https://result.kie.test")) {
      return new Response(FACE, { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (address.startsWith("https://api.elevenlabs.io")) {
      seen.eleven.push(address);
      return json({ voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Studio voice", labels: { gender: "female" } });
    }
    if (address.startsWith(SITE)) {
      const make = SITES[new URL(address).pathname];
      return make ? make() : new Response("nope", { status: 404 });
    }
    return realFetch(url, init);
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await client.close();
  await app.stop();
});

afterEach(() => {
  seen.kie.length = 0;
  seen.eleven.length = 0;
});

const call = async (name, args = {}, who = client) => {
  const res = await who.callTool({ name, arguments: args });
  const text = res.content[0].text;
  return { isError: Boolean(res.isError), text, data: res.isError ? null : JSON.parse(text) };
};

describe("building an avatar through MCP, start to finish", () => {
  let avatarId;

  test("offers the whole toolbox", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of [
      "create_avatar", "update_avatar", "list_voices", "add_voice", "list_knowledge",
      "save_knowledge", "train_from_website", "remove_knowledge", "get_deployment", "set_share_link",
    ]) {
      assert.ok(names.includes(n), `missing ${n}`);
    }
  });

  test("one call: a generated face, a voice, the website learned, published with embed code", async () => {
    env.kie.apiKey = "test-key";
    env.elevenlabs.apiKey = "eleven-key";
    try {
      const voice = await call("add_voice", { elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM", name: "Clinic voice" });
      assert.equal(voice.data.id, "elevenlabs:21m00Tcm4TlvDq8ikWAM");
      assert.equal(voice.data.provider, "elevenlabs");

      const { data, isError, text } = await call("create_avatar", {
        name: "Dr. Bright",
        facePrompt: "a friendly dentist in her forties, white coat, warm smile, clean clinic behind her",
        gender: "female",
        persona: { voice: voice.data.id, language: "en" },
        websiteUrl: `${SITE}/`,
        publish: true,
      });

      assert.equal(isError, false, text);
      avatarId = data.id;
      assert.equal(data.persona.voice, "elevenlabs:21m00Tcm4TlvDq8ikWAM");
      assert.equal(data.persona.systemPrompt, BRIEFING.systemPrompt, "no prompt given, so the site's is used");
      assert.equal(data.persona.greeting, BRIEFING.greeting);
      assert.equal(data.learned.document, "Website: 127.0.0.1");
      assert.ok(data.learned.pages.length >= 1);

      // What a deployer needs.
      assert.equal(data.deployment.avatarId, avatarId);
      assert.equal(data.deployment.agentId, avatarId);
      assert.match(data.deployment.shareLink, /\/talk\/.+/);
      assert.match(data.deployment.embed.widgetScript, /<script src=".*\/embed\.js" data-token="/);
      assert.match(data.deployment.embed.iframe, /<iframe src=".*\/embed\//);
      assert.equal(data.shareLink, data.deployment.shareLink);

      assert.ok(seen.kie.some((u) => u.includes("flux/kontext/generate")), "the face was generated");
    } finally {
      env.kie.apiKey = "";
      env.elevenlabs.apiKey = "";
    }
  });

  test("the user's own system prompt is kept when a website is learned", async () => {
    env.kie.apiKey = "test-key";
    try {
      const { data } = await call("create_avatar", {
        name: "Custom prompt",
        faceId: "face_f01",
        persona: { systemPrompt: "You are a terse receptionist." },
        websiteUrl: `${SITE}/`,
      });
      assert.equal(data.persona.systemPrompt, "You are a terse receptionist.");
      assert.equal(data.learned.briefWritten, false);
      assert.equal(data.deployment, undefined, "not published unless asked");
    } finally {
      env.kie.apiKey = "";
    }
  });

  test("an existing avatar can be changed without being recreated", async () => {
    const { data } = await call("update_avatar", {
      avatarId,
      persona: { greeting: "Welcome to Bright Dental, how can I help?" },
      render: { aspectRatio: "9x16" },
    });
    assert.equal(data.id, avatarId);
    assert.equal(data.persona.greeting, "Welcome to Bright Dental, how can I help?");
    assert.equal(data.persona.voice, "elevenlabs:21m00Tcm4TlvDq8ikWAM", "untouched fields stay");
    assert.ok(data.shareLink, "the link survives");
  });

  test("knowledge can be added by text, replaced when it changes, and removed", async () => {
    const first = await call("save_knowledge", { avatarId, name: "Opening hours", content: "Open 9 to 5, Monday to Saturday." });
    assert.equal(first.data.replaced, false);
    const again = await call("save_knowledge", { avatarId, name: "Opening hours", content: "Now open 8 to 8, every day." });
    assert.equal(again.data.replaced, true);

    const list = await call("list_knowledge", { avatarId });
    const hours = list.data.filter((d) => d.name === "Opening hours");
    assert.equal(hours.length, 1);
    assert.match((await KnowledgeDocument.findById(hours[0]._id)).text, /8 to 8/);

    const removed = await call("remove_knowledge", { avatarId, documentId: hours[0]._id });
    assert.equal(removed.isError, false);
    assert.equal((await call("list_knowledge", { avatarId })).data.some((d) => d.name === "Opening hours"), false);
  });

  test("training from the website again refreshes its knowledge instead of adding another", async () => {
    env.kie.apiKey = "test-key";
    try {
      const before = (await call("list_knowledge", { avatarId })).data.length;
      const res = await call("train_from_website", { avatarId, url: `${SITE}/pricing`, applyBrief: false });
      assert.equal(res.data.briefWritten, false);
      assert.equal((await call("list_knowledge", { avatarId })).data.length, before);
    } finally {
      env.kie.apiKey = "";
    }
  });

  test("get_deployment returns id, link and embed code, and can leave the link off", async () => {
    const on = await call("get_deployment", { avatarId });
    assert.equal(on.data.shareEnabled, true);
    assert.ok(on.data.embed.widgetScript);

    await call("set_share_link", { avatarId, enabled: false });
    const off = await call("get_deployment", { avatarId, enable: false });
    assert.equal(off.data.shareEnabled, false);
    assert.equal(off.data.shareLink, null);
    assert.equal(off.data.embed, null);
  });

  test("list_voices shows the workspace's own voices next to the built-in ones", async () => {
    const { data } = await call("list_voices");
    assert.ok(Array.isArray(data.builtIn));
    assert.deepEqual(data.own.map((v) => v.id), ["elevenlabs:21m00Tcm4TlvDq8ikWAM"]);
  });

  test("it can be repeated for many customers: each gets its own avatar, knowledge and link", async () => {
    env.kie.apiKey = "test-key";
    try {
      const made = [];
      for (const n of ["Customer A", "Customer B", "Customer C"]) {
        made.push((await call("create_avatar", { name: n, faceId: "face_m01", websiteUrl: `${SITE}/`, publish: true })).data);
      }
      assert.equal(new Set(made.map((m) => m.id)).size, 3);
      assert.equal(new Set(made.map((m) => m.deployment.shareLink)).size, 3);
      for (const m of made) assert.equal((await call("list_knowledge", { avatarId: m.id })).data.length, 1);
    } finally {
      env.kie.apiKey = "";
    }
  });

  test("a website that cannot be read does not lose the avatar", async () => {
    env.kie.apiKey = "test-key";
    try {
      const { data } = await call("create_avatar", { name: "Broken site", faceId: "face_f01", websiteUrl: `${SITE}/missing` });
      assert.ok(data.id);
      assert.ok(data.learnError);
    } finally {
      env.kie.apiKey = "";
    }
  });

  test("exactly one face source is required", async () => {
    assert.equal((await call("create_avatar", { name: "No face" })).isError, true);
    assert.equal((await call("create_avatar", { name: "Two", faceId: "face_f01", facePrompt: "a person with a kind face" })).isError, true);
  });

  test("another workspace cannot reach the avatar", async () => {
    const { body } = await stranger.post("/api/api-keys", { name: "other" });
    const other = new Client({ name: "other", version: "1" });
    await other.connect(
      new StreamableHTTPClientTransport(new URL(`${app.baseUrl}/api/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${body.key.key}` } },
      }),
    );
    try {
      assert.equal((await call("save_knowledge", { avatarId, name: "x", content: "y" }, other)).isError, true);
      assert.equal((await call("get_deployment", { avatarId }, other)).isError, true);
      assert.equal((await call("update_avatar", { avatarId, name: "Hijacked" }, other)).isError, true);
    } finally {
      await other.close();
    }
  });
});
