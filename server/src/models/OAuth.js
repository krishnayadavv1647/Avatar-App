import mongoose from "mongoose";

/**
 * OAuth 2.1 storage for the app's MCP endpoint, so Claude.ai, ChatGPT and
 * other connectors can sign a user in instead of pasting a key.
 *
 * Secrets, codes and tokens are only ever stored as SHA-256 hashes.
 */

/** An app that registered itself (RFC 7591 dynamic client registration). */
const clientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true },
    // Set only for clients that asked for a client secret; the rest are public (PKCE).
    secretHash: String,
    name: { type: String, required: true },
    redirectUris: { type: [String], required: true },
  },
  { timestamps: true },
);

/** A one-time authorization code, valid for minutes. */
const codeSchema = new mongoose.Schema({
  codeHash: { type: String, required: true, unique: true },
  clientId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
  redirectUri: { type: String, required: true },
  codeChallenge: { type: String, required: true },
  used: { type: Boolean, default: false },
  // Mongo removes the document once this passes.
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

/** One authorised connection: an access token and its rotating refresh token. */
const tokenSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    accessHash: { type: String, required: true, unique: true },
    accessExpiresAt: { type: Date, required: true },
    refreshHash: { type: String, required: true, unique: true },
    refreshExpiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    lastUsedAt: Date,
    revokedAt: Date,
  },
  { timestamps: true },
);

export const OAuthClient = mongoose.model("OAuthClient", clientSchema);
export const OAuthCode = mongoose.model("OAuthCode", codeSchema);
export const OAuthToken = mongoose.model("OAuthToken", tokenSchema);
