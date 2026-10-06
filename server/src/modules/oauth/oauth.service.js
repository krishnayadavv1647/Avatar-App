import crypto from "node:crypto";
import { OAuthClient, OAuthCode, OAuthToken, User } from "../../models/index.js";
import { env } from "../../config/env.js";

/**
 * The OAuth 2.1 authorization server behind "Connect" in Claude.ai, ChatGPT
 * and other MCP clients: dynamic client registration, authorization code with
 * PKCE (S256 only), rotating refresh tokens.
 *
 * The sign-in and consent screen is the web app's own page (/oauth/authorize);
 * it calls `authorize` below as the signed-in user.
 */
export const SCOPE = "avatars";
const CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ACCESS_PREFIX = "avo_";

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const random = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
const origin = () => env.clientOrigin.replace(/\/$/, "");

/** `invalid_*` follows RFC 6749 so clients can read the error code. */
const oauthError = (error, description, statusCode = 400) =>
  Object.assign(new Error(description), { statusCode, oauth: { error, error_description: description } });

const safeEqual = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** https anywhere, or http on a loopback address (desktop clients listen locally). */
function validRedirectUri(raw) {
  try {
    const url = new URL(raw);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export const metadata = {
  authorizationServer: () => ({
    issuer: origin(),
    authorization_endpoint: `${origin()}/oauth/authorize`,
    token_endpoint: `${origin()}/api/oauth/token`,
    registration_endpoint: `${origin()}/api/oauth/register`,
    revocation_endpoint: `${origin()}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: [SCOPE],
  }),
  protectedResource: () => ({
    resource: `${origin()}/api/mcp`,
    authorization_servers: [origin()],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Avatar Studio",
  }),
  /** Where a 401 from /api/mcp points clients at, per RFC 9728. */
  resourceMetadataUrl: () => `${origin()}/.well-known/oauth-protected-resource/api/mcp`,
};

async function clientFor(clientId) {
  const client = clientId ? await OAuthClient.findOne({ clientId: String(clientId) }) : null;
  if (!client) throw oauthError("invalid_client", "Unknown client", 401);
  return client;
}

/** Public clients prove themselves with PKCE; the others also send their secret. */
async function authenticateClient(clientId, secret) {
  const client = await clientFor(clientId);
  if (client.secretHash && !(secret && safeEqual(sha256(String(secret)), client.secretHash))) {
    throw oauthError("invalid_client", "Wrong client secret", 401);
  }
  return client;
}

function issueTokens() {
  const access = ACCESS_PREFIX + random();
  const refresh = random();
  const fields = {
    accessHash: sha256(access),
    accessExpiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
    refreshHash: sha256(refresh),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  };
  return {
    fields,
    response: {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
      scope: SCOPE,
    },
  };
}

export const oauthService = {
  async registerClient(body) {
    const uris = body?.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((u) => typeof u === "string" && validRedirectUri(u))) {
      throw oauthError("invalid_redirect_uri", "redirect_uris must be https URLs (or http on localhost)");
    }
    const wantsSecret = ["client_secret_post", "client_secret_basic"].includes(body.token_endpoint_auth_method);
    const secret = wantsSecret ? random() : null;
    const name = String(body.client_name || "MCP client").replace(/[\u0000-\u001f]/g, "").slice(0, 100) || "MCP client";

    const client = await OAuthClient.create({
      clientId: `cl_${random(16)}`,
      secretHash: secret ? sha256(secret) : undefined,
      name,
      redirectUris: uris,
    });

    return {
      client_id: client.clientId,
      ...(secret && { client_secret: secret }),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: secret ? "client_secret_post" : "none",
      scope: SCOPE,
    };
  },

  /** Validates an authorization request and says who is asking, for the consent screen. */
  async describeRequest(params) {
    const client = await clientFor(params.client_id).catch(() => {
      throw oauthError("invalid_request", "This app is not registered");
    });
    if (!client.redirectUris.includes(params.redirect_uri)) {
      throw oauthError("invalid_request", "The redirect address does not match the app's registration");
    }
    if (params.response_type !== "code") throw oauthError("invalid_request", "Only response_type=code is supported");
    if (!params.code_challenge || params.code_challenge_method !== "S256") {
      throw oauthError("invalid_request", "PKCE with code_challenge_method=S256 is required");
    }
    if (params.resource && params.resource !== metadata.protectedResource().resource) {
      throw oauthError("invalid_target", "Unknown resource");
    }
    return { client, redirectHost: new URL(params.redirect_uri).host };
  },

  /** The user's answer on the consent screen. Returns where to send the browser. */
  async authorize({ userId, workspaceId, params, allow }) {
    const { client } = await this.describeRequest(params);
    const target = new URL(params.redirect_uri);
    if (params.state) target.searchParams.set("state", params.state);
    target.searchParams.set("iss", origin());

    if (!allow) {
      target.searchParams.set("error", "access_denied");
      return target.toString();
    }

    const code = random();
    await OAuthCode.create({
      codeHash: sha256(code),
      clientId: client.clientId,
      userId,
      workspaceId,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    target.searchParams.set("code", code);
    return target.toString();
  },

  async token(body) {
    if (body.grant_type === "authorization_code") return this.exchangeCode(body);
    if (body.grant_type === "refresh_token") return this.refresh(body);
    throw oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  },

  async exchangeCode({ client_id, client_secret, code, redirect_uri, code_verifier }) {
    const client = await authenticateClient(client_id, client_secret);
    if (!code || !code_verifier) throw oauthError("invalid_request", "code and code_verifier are required");

    // Atomic, so a code cannot be exchanged twice by two racing requests.
    const grant = await OAuthCode.findOneAndUpdate(
      { codeHash: sha256(String(code)), used: false, expiresAt: { $gt: new Date() } },
      { $set: { used: true } },
    );
    const challenge = crypto.createHash("sha256").update(String(code_verifier)).digest("base64url");
    if (
      !grant ||
      grant.clientId !== client.clientId ||
      grant.redirectUri !== redirect_uri ||
      !safeEqual(challenge, grant.codeChallenge)
    ) {
      throw oauthError("invalid_grant", "The code is invalid, expired or already used");
    }

    const issued = issueTokens();
    await OAuthToken.create({
      clientId: client.clientId,
      userId: grant.userId,
      workspaceId: grant.workspaceId,
      ...issued.fields,
    });
    return issued.response;
  },

  /** Rotates: the old refresh token stops working as the new pair is issued. */
  async refresh({ client_id, client_secret, refresh_token }) {
    const client = await authenticateClient(client_id, client_secret);
    if (!refresh_token) throw oauthError("invalid_request", "refresh_token is required");

    const issued = issueTokens();
    const token = await OAuthToken.findOneAndUpdate(
      {
        refreshHash: sha256(String(refresh_token)),
        clientId: client.clientId,
        revokedAt: null,
        refreshExpiresAt: { $gt: new Date() },
      },
      { $set: issued.fields },
    );
    if (!token) throw oauthError("invalid_grant", "The refresh token is invalid or expired");
    return issued.response;
  },

  async revoke({ token, client_id, client_secret }) {
    if (!token) return;
    await authenticateClient(client_id, client_secret);
    const hash = sha256(String(token));
    await OAuthToken.updateOne(
      { clientId: client_id, $or: [{ accessHash: hash }, { refreshHash: hash }], revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  },

  /** The owner and workspace an access token acts for, or null. */
  async authenticateAccess(token) {
    if (!token?.startsWith(ACCESS_PREFIX)) return null;
    const row = await OAuthToken.findOne({
      accessHash: sha256(token),
      revokedAt: null,
      accessExpiresAt: { $gt: new Date() },
    });
    if (!row) return null;
    if (await User.exists({ _id: row.userId, blockedAt: { $ne: null } })) return null;
    OAuthToken.updateOne({ _id: row._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    return { userId: String(row.userId), workspaceId: String(row.workspaceId) };
  },

  /** Apps the user has connected, for the "AI tools" page. */
  async connections(userId) {
    const rows = await OAuthToken.find({ userId, revokedAt: null }).sort({ createdAt: -1 }).lean();
    const clients = await OAuthClient.find({ clientId: { $in: rows.map((r) => r.clientId) } }).lean();
    const names = new Map(clients.map((c) => [c.clientId, c.name]));
    return rows.map((r) => ({
      _id: r._id,
      name: names.get(r.clientId) || "Unknown app",
      connectedAt: r.createdAt,
      lastUsedAt: r.lastUsedAt || null,
    }));
  },

  async disconnect(userId, id) {
    const res = await OAuthToken.updateOne({ _id: id, userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    if (!res.modifiedCount) throw Object.assign(new Error("Connection not found"), { statusCode: 404 });
    return { id };
  },
};
