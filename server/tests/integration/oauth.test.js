/**
 * OAuth for the MCP endpoint: what Claude.ai and ChatGPT do when you press Connect.
 */
import "../setup-env.js";
import crypto from "node:crypto";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { signUp, startTestApp } from "../helpers.js";
import { env } from "../../src/config/env.js";

let app;
let user;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

before(async () => {
  app = await startTestApp();
  user = await signUp(app.baseUrl);
});

after(() => app.stop());

const post = (path, body, type = "json") =>
  fetch(`${app.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": type === "json" ? "application/json" : "application/x-www-form-urlencoded" },
    body: type === "json" ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  });

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
};

async function register(extra = {}) {
  const res = await post("/api/oauth/register", { client_name: "Claude", redirect_uris: [REDIRECT], ...extra });
  assert.equal(res.status, 200);
  return res.json();
}

/** Signs in as the user on the consent screen and returns the code. */
async function authorize(client, challenge, { allow = true, redirect = REDIRECT } = {}) {
  const { status, body } = await user.post("/api/oauth/authorize", {
    client_id: client.client_id,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    allow,
  });
  return { status, body, url: body?.redirectTo && new URL(body.redirectTo) };
}

const exchange = (client, code, verifier, extra = {}) =>
  post(
    "/api/oauth/token",
    {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      ...extra,
    },
    "form",
  );

async function mcpClient(token) {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${app.baseUrl}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

describe("discovery", () => {
  test("an unauthenticated MCP request points at the resource metadata", async () => {
    const res = await post("/api/mcp", {});
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate"), /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
  });

  test("serves both metadata documents", async () => {
    const pr = await (await fetch(`${app.baseUrl}/.well-known/oauth-protected-resource/api/mcp`)).json();
    assert.match(pr.resource, /\/api\/mcp$/);
    assert.ok(pr.authorization_servers.length);

    const as = await (await fetch(`${app.baseUrl}/.well-known/oauth-authorization-server`)).json();
    assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
    assert.match(as.registration_endpoint, /\/api\/oauth\/register$/);
    assert.match(as.token_endpoint, /\/api\/oauth\/token$/);
  });
});

describe("web app hosted apart from the API", () => {
  test("sends API endpoints to the API and only the consent page to the web app", async () => {
    const before = env.publicUrl;
    env.publicUrl = "https://api.example.com/";
    try {
      const as = await (await fetch(`${app.baseUrl}/.well-known/oauth-authorization-server`)).json();
      assert.equal(as.issuer, "https://api.example.com");
      assert.equal(as.token_endpoint, "https://api.example.com/api/oauth/token");
      assert.equal(as.registration_endpoint, "https://api.example.com/api/oauth/register");
      assert.equal(new URL(as.authorization_endpoint).origin, new URL(env.clientOrigin).origin);

      const pr = await (await fetch(`${app.baseUrl}/.well-known/oauth-protected-resource/api/mcp`)).json();
      assert.equal(pr.resource, "https://api.example.com/api/mcp");
    } finally {
      env.publicUrl = before;
    }
  });
});

describe("registration", () => {
  test("rejects redirect addresses that could leak a code", async () => {
    for (const uri of ["http://evil.example/cb", "javascript:alert(1)", "https://x.example/cb#frag"]) {
      const res = await post("/api/oauth/register", { redirect_uris: [uri] });
      assert.equal(res.status, 400, uri);
      assert.equal((await res.json()).error, "invalid_redirect_uri");
    }
  });

  test("allows loopback http for desktop clients", async () => {
    const res = await post("/api/oauth/register", { redirect_uris: ["http://127.0.0.1:33418/callback"] });
    assert.equal(res.status, 200);
  });
});

describe("authorization code flow", () => {
  test("connects, calls a tool, refreshes, and can be disconnected", async () => {
    const client = await register();
    const { verifier, challenge } = pkce();

    const auth = await authorize(client, challenge);
    assert.equal(auth.status, 200);
    assert.equal(auth.url.origin + auth.url.pathname, REDIRECT);
    assert.equal(auth.url.searchParams.get("state"), "xyz");

    const tokenRes = await exchange(client, auth.url.searchParams.get("code"), verifier);
    assert.equal(tokenRes.status, 200);
    const tokens = await tokenRes.json();
    assert.match(tokens.access_token, /^avo_/);
    assert.equal(tokens.token_type, "Bearer");

    // The access token works on the MCP endpoint, as that user.
    const mcp = await mcpClient(tokens.access_token);
    const listed = await mcp.callTool({ name: "list_avatars", arguments: {} });
    assert.equal(listed.isError, undefined);
    await mcp.close();

    // Refreshing rotates: the old refresh token is dead afterwards.
    const refreshed = await post(
      "/api/oauth/token",
      { grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token },
      "form",
    );
    assert.equal(refreshed.status, 200);
    const next = await refreshed.json();
    assert.notEqual(next.access_token, tokens.access_token);
    await assert.rejects(mcpClient(tokens.access_token));
    const replay = await post(
      "/api/oauth/token",
      { grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token },
      "form",
    );
    assert.equal(replay.status, 400);

    // It shows up under the user's connections, and disconnecting kills it.
    const { body } = await user.get("/api/oauth/connections");
    assert.equal(body.connections.length >= 1, true);
    assert.equal(body.connections[0].name, "Claude");
    await user.del(`/api/oauth/connections/${body.connections[0]._id}`);
    await assert.rejects(mcpClient(next.access_token));
  });

  test("a code works once", async () => {
    const client = await register();
    const { verifier, challenge } = pkce();
    const code = (await authorize(client, challenge)).url.searchParams.get("code");

    assert.equal((await exchange(client, code, verifier)).status, 200);
    const again = await exchange(client, code, verifier);
    assert.equal(again.status, 400);
    assert.equal((await again.json()).error, "invalid_grant");
  });

  test("the wrong PKCE verifier is refused", async () => {
    const client = await register();
    const { challenge } = pkce();
    const code = (await authorize(client, challenge)).url.searchParams.get("code");
    const res = await exchange(client, code, pkce().verifier);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_grant");
  });

  test("a code cannot be used by another client", async () => {
    const client = await register();
    const thief = await register();
    const { verifier, challenge } = pkce();
    const code = (await authorize(client, challenge)).url.searchParams.get("code");
    assert.equal((await exchange(thief, code, verifier)).status, 400);
  });

  test("refuses a redirect address the client did not register", async () => {
    const client = await register();
    const res = await authorize(client, pkce().challenge, { redirect: "https://evil.example/cb" });
    assert.equal(res.status, 400);
  });

  test("requires PKCE", async () => {
    const client = await register();
    const { status } = await user.post("/api/oauth/authorize", {
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      response_type: "code",
      allow: true,
    });
    assert.equal(status, 400);
  });

  test("denying sends the browser back with access_denied", async () => {
    const client = await register();
    const res = await authorize(client, pkce().challenge, { allow: false });
    assert.equal(res.url.searchParams.get("error"), "access_denied");
    assert.equal(res.url.searchParams.get("code"), null);
  });

  test("the consent screen needs a signed-in user", async () => {
    const client = await register();
    const res = await fetch(
      `${app.baseUrl}/api/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&code_challenge=x&code_challenge_method=S256`,
    );
    assert.equal(res.status, 401);
  });

  test("a client with a secret must present it", async () => {
    const client = await register({ token_endpoint_auth_method: "client_secret_post" });
    assert.ok(client.client_secret);
    const { verifier, challenge } = pkce();
    const code = (await authorize(client, challenge)).url.searchParams.get("code");

    const without = await exchange(client, code, verifier);
    assert.equal(without.status, 401);
    // The failed attempt did not burn the code.
    const withSecret = await exchange(client, code, verifier, { client_secret: client.client_secret });
    assert.equal(withSecret.status, 200);
  });
});
