/**
 * The app as an MCP server: API keys, and avatar management through /api/mcp.
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { signUp, startTestApp } from "../helpers.js";

let app;
let user;
let other;
let key;

before(async () => {
  app = await startTestApp();
  user = await signUp(app.baseUrl);
  other = await signUp(app.baseUrl);
  const res = await user.post("/api/api-keys", { name: "Claude" });
  key = res.body.key.key;
});

after(() => app.stop());

async function connect(token) {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${app.baseUrl}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

const call = async (client, name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return { isError: Boolean(res.isError), data: res.content[0].text };
};

describe("API keys", () => {
  test("the key is shown once and never listed", async () => {
    assert.match(key, /^avt_/);
    const { body } = await user.get("/api/api-keys");
    assert.equal(body.keys.length, 1);
    assert.equal(JSON.stringify(body).includes(key), false);
  });

  test("need a signed-in account", async () => {
    const res = await fetch(`${app.baseUrl}/api/api-keys`);
    assert.equal(res.status, 401);
  });
});

describe("/api/mcp", () => {
  test("refuses a missing or wrong key", async () => {
    const none = await fetch(`${app.baseUrl}/api/mcp`, { method: "POST", body: "{}" });
    assert.equal(none.status, 401);
    await assert.rejects(connect("avt_not-a-real-key"));
  });

  test("offers the avatar tools", async () => {
    const client = await connect(key);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["list_avatars", "create_avatar", "update_avatar", "delete_avatar", "set_share_link"]) {
      assert.ok(names.includes(n), `missing ${n}`);
    }
    await client.close();
  });

  test("creates, edits, shares and deletes an avatar from a library face", async () => {
    const client = await connect(key);

    const created = await call(client, "create_avatar", {
      name: "Maya",
      faceId: "face_f01",
      persona: { greeting: "Hello from Claude" },
    });
    assert.equal(created.isError, false, created.data);
    const avatar = JSON.parse(created.data);
    assert.equal(avatar.name, "Maya");

    const updated = await call(client, "update_avatar", { avatarId: avatar.id, name: "Maya 2" });
    assert.equal(JSON.parse(updated.data).name, "Maya 2");

    const shared = await call(client, "set_share_link", { avatarId: avatar.id, enabled: true });
    assert.match(JSON.parse(shared.data).link, /\/talk\//);

    // The web app sees what the assistant made.
    const { body } = await user.get("/api/avatars");
    assert.ok(body.avatars.some((a) => a._id === avatar.id));

    const deleted = await call(client, "delete_avatar", { avatarId: avatar.id });
    assert.equal(deleted.isError, false);
    await client.close();
  });

  test("needs exactly one face source", async () => {
    const client = await connect(key);
    const res = await call(client, "create_avatar", { name: "No face" });
    assert.equal(res.isError, true);
    assert.match(res.data, /faceId, photoUrl or facePrompt/);
    await client.close();
  });

  test("cannot reach another workspace's avatars", async () => {
    const client = await connect(key);
    const made = await call(client, "create_avatar", { name: "Mine", faceId: "face_f02" });
    const id = JSON.parse(made.data).id;

    const otherKey = (await other.post("/api/api-keys", { name: "Other" })).body.key.key;
    const otherClient = await connect(otherKey);
    const res = await call(otherClient, "get_avatar", { avatarId: id });
    assert.equal(res.isError, true);
    assert.deepEqual(JSON.parse((await call(otherClient, "list_avatars")).data), []);

    await client.close();
    await otherClient.close();
  });

  test("a revoked key stops working", async () => {
    const fresh = (await user.post("/api/api-keys", { name: "Temp" })).body.key;
    await user.del(`/api/api-keys/${fresh._id}`);
    await assert.rejects(connect(fresh.key));
  });

  test("fails cleanly when the photo cannot be downloaded", async () => {
    const client = await connect(key);
    const res = await call(client, "create_avatar", { name: "Bad", photoUrl: "http://127.0.0.1:1/x.jpg" });
    assert.equal(res.isError, true);
    await client.close();
  });
});
