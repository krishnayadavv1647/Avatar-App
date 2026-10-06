import mongoose from "mongoose";

/**
 * A personal access key for the app's own MCP endpoint (/api/mcp), so Claude,
 * ChatGPT, Cursor and the like can act as the person who made it.
 *
 * Only a SHA-256 of the key is stored. The key itself is shown once at
 * creation; a lost key is replaced, not recovered.
 */
const apiKeySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    name: { type: String, required: true, trim: true },
    // First characters of the key, to tell keys apart in the list.
    prefix: { type: String, required: true },
    hash: { type: String, required: true, unique: true },
    lastUsedAt: Date,
    revokedAt: Date,
  },
  { timestamps: true },
);

export const ApiKey = mongoose.model("ApiKey", apiKeySchema);
