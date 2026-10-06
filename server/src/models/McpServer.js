import mongoose from "mongoose";

/**
 * An MCP server an avatar can call tools on during a conversation.
 *
 * The auth token is stored encrypted (utils/secretBox.js) and never returned
 * by the API - the listing only says whether one is set.
 */
const mcpServerSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    avatarId: { type: mongoose.Schema.Types.ObjectId, ref: "Avatar", required: true, index: true },
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    // Sent as `Authorization: Bearer <token>`.
    authToken: { type: String, select: false },
    enabled: { type: Boolean, default: true },
    // From the last successful connection, so the UI can show what it offers.
    toolNames: { type: [String], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

mcpServerSchema.index({ workspaceId: 1, avatarId: 1, createdAt: 1 });

export const McpServer = mongoose.model("McpServer", mcpServerSchema);
