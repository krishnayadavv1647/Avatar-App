import { McpServer } from "../../models/index.js";
import { avatarRepository } from "./avatar.repository.js";
import { probeMcpServer } from "../../integrations/mcp/index.js";
import { open, seal } from "../../utils/secretBox.js";
import { logger } from "../../config/logger.js";

/** Servers per avatar - each one is a connection opened at the start of every call. */
export const MAX_MCP_SERVERS = 5;

const notFound = (what) => Object.assign(new Error(`${what} not found`), { statusCode: 404 });

/** Listing shape: never the token. */
const summary = (s) => ({
  _id: s._id,
  name: s.name,
  url: s.url,
  enabled: s.enabled,
  toolNames: s.toolNames,
  createdAt: s.createdAt,
});

async function assertAvatar(workspaceId, avatarId) {
  if (!(await avatarRepository.findById(workspaceId, avatarId))) throw notFound("Avatar");
}

export const mcpService = {
  async list(workspaceId, avatarId) {
    await assertAvatar(workspaceId, avatarId);
    const servers = await McpServer.find({ workspaceId, avatarId }).sort({ createdAt: 1 }).lean();
    return servers.map(summary);
  },

  /** Connects first, so a wrong URL or token is refused instead of failing silently on calls. */
  async add(workspaceId, avatarId, { name, url, authToken }, userId) {
    await assertAvatar(workspaceId, avatarId);
    const count = await McpServer.countDocuments({ workspaceId, avatarId });
    if (count >= MAX_MCP_SERVERS) {
      throw Object.assign(new Error(`An avatar can use ${MAX_MCP_SERVERS} MCP servers. Remove one first.`), {
        statusCode: 422,
      });
    }

    const toolNames = await probeMcpServer({ url, token: authToken });
    const server = await McpServer.create({
      workspaceId,
      avatarId,
      name,
      url,
      authToken: authToken ? seal(authToken) : undefined,
      toolNames,
      createdBy: userId,
    });
    logger.info({ avatarId: String(avatarId), tools: toolNames.length }, "mcp server added");
    return summary(server);
  },

  async setEnabled(workspaceId, avatarId, serverId, enabled) {
    await assertAvatar(workspaceId, avatarId);
    const server = await McpServer.findOneAndUpdate(
      { _id: serverId, workspaceId, avatarId },
      { $set: { enabled } },
      { new: true },
    );
    if (!server) throw notFound("MCP server");
    return summary(server);
  },

  async remove(workspaceId, avatarId, serverId) {
    await assertAvatar(workspaceId, avatarId);
    const deleted = await McpServer.findOneAndDelete({ _id: serverId, workspaceId, avatarId });
    if (!deleted) throw notFound("MCP server");
    return { id: serverId };
  },

  /** Enabled servers with their tokens decrypted - for the agent worker only. */
  async forCall(avatarId) {
    const servers = await McpServer.find({ avatarId, enabled: true })
      .sort({ createdAt: 1 })
      .select("+authToken")
      .lean();
    return servers.map((s) => {
      let token;
      try {
        token = s.authToken ? open(s.authToken) : undefined;
      } catch {
        logger.warn({ server: s.name }, "mcp: stored token could not be decrypted (key changed?)");
      }
      return { name: s.name, url: s.url, token };
    });
  },

  removeAllFor: (workspaceId, avatarId) => McpServer.deleteMany({ workspaceId, avatarId }),
};
