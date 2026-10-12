/**
 * What an MCP client can do that the web app already could: start from a
 * template, give an avatar a new face, and attach external tools to it.
 */
import "../setup-env.js";
import http from "node:http";
import { pathToFileURL } from "node:url";
import path from "node:path";
import test, { after, afterEach, before, describe } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { env } from "../../src/config/env.js";
import { TEMPLATES } from "../../src/ai/templates.js";
import { signUp, startTestApp } from "../helpers.js";

let app;
let client;
let stranger;
let toolServer;
let toolServerUrl;
const realFetch = globalThis.fetch;
const JPEG = Buffer.alloc(30_000, 9);
const pictures = [];

before(async () => {
  app = await startTestApp({ seed: false });
  const owner = await signUp(app.baseUrl);
  stranger = await signUp(app.baseUrl);
  const { body } = await owner.post("/api/api-keys", { name: "parity" });
  client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${app.baseUrl}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${body.key.key}` } },
    }),
  );

  // A real, tiny MCP server for an avatar to attach.
  toolServer = http.createServer(async (req, res) => {
    const server = new McpServer({ name: "tasks", version: "1.0.0" });
    server.registerTool("create_task", { description: "Create a task", inputSchema: { title: z.string() } }, async ({ title }) => ({
      content: [{ type: "text", text: `created ${title}` }],
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    let raw = "";
    for await (const chunk of req) raw += chunk;
    await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
  });
  await new Promise((resolve) => toolServer.listen(0, "127.0.0.1", resolve));
  toolServerUrl = `http://127.0.0.1:${toolServer.address().port}/mcp`;

  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (address.includes("/presets/")) {
      pictures.push(address);
      return address.includes("receptionist")
        ? new Response("nope", { status: 404 })
        : new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return realFetch(url, init);
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await client.close();
  await new Promise((resolve) => toolServer.close(resolve));
  await app.stop();
});

afterEach(() => {
  pictures.length = 0;
});

const call = async (name, args = {}, who = client) => {
  const res = await who.callTool({ name, arguments: args });
  const text = res.content[0].text;
  return { isError: Boolean(res.isError), text, data: res.isError ? null : JSON.parse(text) };
};

describe("templates", () => {
  test("the server's list is the web app's list, word for word", async () => {
    const client = await import(pathToFileURL(path.resolve("../client/src/features/studio/presets.js")).href);
    assert.equal(TEMPLATES.length, 25);
    for (const preset of client.PRESETS) {
      const mine = TEMPLATES.find((t) => t.id === preset.id);
      assert.ok(mine, `server is missing template ${preset.id}`);
      for (const field of ["label", "description", "gender", "systemPrompt", "greeting", "motionPrompt", "temperature"]) {
        assert.equal(mine[field], preset[field], `${preset.id}.${field} differs from the web app`);
      }
    }
  });

  test("list_templates describes each one with its face address", async () => {
    const { data } = await call("list_templates");
    assert.equal(data.templates.length, 25);
    const boss = data.templates.find((t) => t.id === "boss");
    assert.match(boss.faceUrl, /\/presets\/boss\.jpg$/);
    assert.ok(boss.instructions.length > 50);
  });

  test("create_avatar from a template brings its face, instructions and greeting", async () => {
    const { data, isError, text } = await call("create_avatar", { name: "Our boss", template: "boss" });
    assert.equal(isError, false, text);
    assert.equal(data.gender, "male");
    assert.equal(data.persona.greeting, TEMPLATES.find((t) => t.id === "boss").greeting);
    assert.match(data.persona.systemPrompt, /senior executive/);
    assert.equal(pictures.length, 1);
    assert.match(pictures[0], /\/presets\/boss\.jpg$/);
  });

  test("what is passed explicitly overrides the template, and the template's gender can be overridden", async () => {
    const { data } = await call("create_avatar", {
      name: "Custom boss",
      template: "boss",
      gender: "female",
      persona: { greeting: "Welcome to Acme." },
    });
    assert.equal(data.persona.greeting, "Welcome to Acme.");
    assert.match(data.persona.systemPrompt, /senior executive/);
    assert.equal(data.gender, "female");
  });

  test("a template whose picture cannot be fetched still makes an avatar, with a library face", async () => {
    const { data, isError, text } = await call("create_avatar", { name: "Front desk", template: "receptionist" });
    assert.equal(isError, false, text);
    assert.ok(data.id);
    assert.equal(data.gender, "female");
  });

  test("refuses an unknown template, and a template together with two faces", async () => {
    assert.equal((await call("create_avatar", { name: "x", template: "wizard" })).isError, true);
    assert.equal(
      (await call("create_avatar", { name: "x", template: "boss", faceId: "face_f01", facePrompt: "a person with a kind face" })).isError,
      true,
    );
  });
});

describe("replace_face", () => {
  test("keeps the avatar, its brief and its link, and changes only the face", async () => {
    const made = (await call("create_avatar", {
      name: "Same avatar",
      faceId: "face_f01",
      persona: { systemPrompt: "You are Sam.", greeting: "Hi, I am Sam." },
      publish: true,
    })).data;

    const { data, isError, text } = await call("replace_face", { avatarId: made.id, faceId: "face_f02" });

    assert.equal(isError, false, text);
    assert.equal(data.id, made.id);
    assert.equal(data.persona.systemPrompt, "You are Sam.");
    assert.equal(data.persona.greeting, "Hi, I am Sam.");
    assert.equal(data.shareLink, made.deployment.shareLink);
  });

  test("needs exactly one face, and the avatar must be the caller's", async () => {
    const made = (await call("create_avatar", { name: "Owned", faceId: "face_f01" })).data;
    assert.equal((await call("replace_face", { avatarId: made.id })).isError, true);

    const { body } = await stranger.post("/api/api-keys", { name: "other" });
    const other = new Client({ name: "other", version: "1" });
    await other.connect(
      new StreamableHTTPClientTransport(new URL(`${app.baseUrl}/api/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${body.key.key}` } },
      }),
    );
    try {
      assert.equal((await call("replace_face", { avatarId: made.id, faceId: "face_f02" }, other)).isError, true);
    } finally {
      await other.close();
    }
  });
});

describe("tools an avatar can use on calls", () => {
  test("attach, list, switch off and remove an external MCP server", async () => {
    const avatar = (await call("create_avatar", { name: "Manager", faceId: "face_m01" })).data;

    const added = await call("add_avatar_tool", { avatarId: avatar.id, name: "Tasks", url: toolServerUrl, authToken: "secret-token" });
    assert.equal(added.isError, false, added.text);
    assert.ok(added.data.tools?.includes("create_task") || added.data.toolNames?.includes("create_task") || JSON.stringify(added.data).includes("create_task"));
    assert.ok(!JSON.stringify(added.data).includes("secret-token"), "the token is never echoed");

    const listed = await call("list_avatar_tools", { avatarId: avatar.id });
    assert.equal(listed.data.length, 1);
    assert.ok(!JSON.stringify(listed.data).includes("secret-token"));

    const serverId = listed.data[0]._id || listed.data[0].id;
    const off = await call("set_avatar_tool_enabled", { avatarId: avatar.id, serverId, enabled: false });
    assert.equal(off.isError, false, off.text);
    assert.equal((await call("list_avatar_tools", { avatarId: avatar.id })).data[0].enabled, false);

    assert.equal((await call("remove_avatar_tool", { avatarId: avatar.id, serverId })).isError, false);
    assert.deepEqual((await call("list_avatar_tools", { avatarId: avatar.id })).data, []);
  });

  test("an address that is not a working MCP server is refused", async () => {
    const avatar = (await call("create_avatar", { name: "Manager 2", faceId: "face_m01" })).data;
    const res = await call("add_avatar_tool", { avatarId: avatar.id, name: "Nothing", url: `http://127.0.0.1:9/mcp` });
    assert.equal(res.isError, true);
  });
});

describe("the toolbox as a whole", () => {
  test("everything from this round is offered", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of [
      "list_templates", "replace_face", "list_avatar_tools", "add_avatar_tool", "set_avatar_tool_enabled",
      "remove_avatar_tool", "get_knowledge", "test_avatar_reply", "list_leads", "list_handoff_requests",
    ]) {
      assert.ok(names.includes(n), `missing ${n}`);
    }
    assert.ok(env.clientOrigin);
  });
});
