import dns from "node:dns/promises";
import net from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { llm } from "@livekit/agents";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

/**
 * MCP client side: connects to a server the user registered for an avatar and
 * exposes its tools to the call's language model.
 *
 * The URL is user-supplied and fetched by our servers, so it is checked
 * against private and loopback addresses first (SSRF). Local addresses are
 * allowed only outside production, so a dev can point at an MCP server on
 * their own machine.
 */
const CONNECT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 20_000;
/** Models cope badly with hundreds of tools; also bounds the prompt size. */
const MAX_TOOLS_PER_SERVER = 40;
/** A reply longer than this is cut - it is read aloud, and sent back to the model. */
const MAX_RESULT_CHARS = 8_000;

const isProd = env.nodeEnv === "production";

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Throws a 422 unless the URL is one we are willing to connect to. */
export async function assertSafeUrl(raw) {
  const reject = (msg) => Object.assign(new Error(msg), { statusCode: 422 });
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw reject("That is not a valid URL");
  }
  if (!["https:", "http:"].includes(url.protocol)) throw reject("The MCP server URL must start with https://");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [host]
    : (await dns.lookup(host, { all: true }).catch(() => { throw reject(`Could not resolve ${host}`); })).map((a) => a.address);

  const local = addresses.some(isPrivateIp);
  if (local && isProd) throw reject("MCP servers on private or local addresses are not allowed");
  if (url.protocol === "http:" && !local && isProd) throw reject("The MCP server URL must use https://");
  return url;
}

async function open({ url, token }) {
  const parsed = await assertSafeUrl(url);
  const requestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
  const signal = AbortSignal.timeout(CONNECT_TIMEOUT_MS);

  const attempt = async (transport) => {
    const client = new Client({ name: "avatar-studio", version: "1.0.0" });
    try {
      await client.connect(transport, { signal });
      return client;
    } catch (err) {
      await client.close().catch(() => {});
      throw err;
    }
  };

  try {
    return await attempt(new StreamableHTTPClientTransport(parsed, { requestInit }));
  } catch (err) {
    // Older servers speak SSE only. Auth failures are not worth a second try.
    if (/40[13]/.test(err?.message || "")) throw err;
    return attempt(new SSEClientTransport(parsed, { requestInit }));
  }
}

/** Connects, lists the tools, disconnects. For "Add server" validation. */
export async function probeMcpServer({ url, token }) {
  let client;
  try {
    client = await open({ url, token });
    const { tools } = await client.listTools();
    return tools.map((t) => t.name);
  } catch (err) {
    if (err.statusCode) throw err;
    const reason = /401|403/.test(err.message) ? "it rejected the auth token" : err.message;
    throw Object.assign(new Error(`Could not connect to the MCP server: ${reason}`), { statusCode: 422 });
  } finally {
    await client?.close().catch(() => {});
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "mcp";

/** Spoken-friendly text from an MCP tool result. */
function resultText(result) {
  const text = (result.content || [])
    .map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
    .join("\n")
    .slice(0, MAX_RESULT_CHARS);
  if (result.isError) throw new llm.ToolError(text || "The tool failed");
  return text || "Done";
}


/**
 * Connects every server and returns their tools as one flat list for the
 * agent. A server that cannot be reached is logged and skipped: a broken
 * integration must not stop the call from starting.
 *
 * Tool names are prefixed with the server's name so two servers offering
 * "search" do not collide.
 *
 * @param {{ name: string, url: string, token?: string }[]} servers
 * @returns {Promise<{ tools: llm.FunctionTool[], close: () => Promise<void> }>}
 */
export async function connectMcpTools(servers) {
  const clients = [];
  const perServer = await Promise.all(
    servers.map(async (server, i) => {
      try {
        const client = await open(server);
        clients.push(client);
        const { tools } = await client.listTools();
        const prefix = `${slug(server.name)}${i}`;

        const mapped = tools.slice(0, MAX_TOOLS_PER_SERVER).map((t) =>
          llm.tool({
            name: `${prefix}_${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
            description: `[${server.name}] ${t.description || t.name}`,
            parameters: { type: "object", properties: {}, ...t.inputSchema },
            execute: async (args) =>
              resultText(
                await client.callTool({ name: t.name, arguments: args }, undefined, {
                  timeout: CALL_TIMEOUT_MS,
                }),
              ),
          }),
        );
        logger.info({ server: server.name, tools: mapped.length }, "mcp: connected");
        return mapped;
      } catch (err) {
        logger.warn({ server: server.name, err: err.message }, "mcp: server skipped");
        return [];
      }
    }),
  );

  return {
    tools: perServer.flat(),
    close: () => Promise.all(clients.map((c) => c.close().catch(() => {}))).then(() => {}),
  };
}
