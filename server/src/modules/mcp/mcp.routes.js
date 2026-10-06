import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { apiKeyService } from "../apiKeys/apiKey.service.js";
import { createAvatarMcpServer } from "./mcp.tools.js";
import { Workspace } from "../../models/index.js";
import { logger } from "../../config/logger.js";

/**
 * POST /api/mcp - the app as an MCP server (streamable HTTP, stateless).
 *
 * Authenticated by a personal key (`Authorization: Bearer avt_...`) made on the
 * "AI tools" page. Stateless: every request builds its own server and
 * transport, so nothing is held between calls and any instance can answer.
 */
const router = Router();

router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: { error: { message: "Too many requests. Slow down." } },
  }),
);

const rpcError = (res, status, message) =>
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });

router.post("/", async (req, res) => {
  const [scheme, token] = (req.headers.authorization || "").split(" ");
  const who = scheme?.toLowerCase() === "bearer" ? await apiKeyService.authenticate(token) : null;
  if (!who) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="avatar-studio"');
    return rpcError(res, 401, "Missing or invalid API key");
  }

  const workspace = await Workspace.findById(who.workspaceId);
  if (!workspace) return rpcError(res, 403, "Workspace no longer exists");

  const server = createAvatarMcpServer({ workspace, userId: who.userId });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error({ err }, "mcp request failed");
    if (!res.headersSent) rpcError(res, 500, "Internal error");
  }
});

// Stateless: there is no session to resume or end.
const notAllowed = (req, res) => rpcError(res, 405, "Method not allowed");
router.get("/", notAllowed);
router.delete("/", notAllowed);

export default router;
