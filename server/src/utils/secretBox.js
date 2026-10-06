import crypto from "node:crypto";
import { env } from "../config/env.js";

/**
 * AES-256-GCM for small secrets kept in the database (an MCP server's token).
 * Output is `iv.tag.ciphertext`, base64url. Throws if no key is configured.
 */
function key() {
  if (!env.mcpEncryptionKey) {
    const err = new Error("Set MCP_ENCRYPTION_KEY (or JWT_REFRESH_SECRET) to store MCP auth tokens.");
    err.statusCode = 500;
    throw err;
  }
  return crypto.createHash("sha256").update(env.mcpEncryptionKey).digest();
}

export function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function open(sealed) {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
