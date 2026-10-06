import crypto from "node:crypto";
import { ApiKey, User } from "../../models/index.js";

/** Keys per user. Plenty for a few tools; bounded so the list stays readable. */
const MAX_KEYS = 10;
const KEY_PREFIX = "avt_";

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const summary = (k) => ({
  _id: k._id,
  name: k.name,
  prefix: k.prefix,
  lastUsedAt: k.lastUsedAt || null,
  createdAt: k.createdAt,
});

export const apiKeyService = {
  async list(userId) {
    const keys = await ApiKey.find({ userId, revokedAt: null }).sort({ createdAt: -1 }).lean();
    return keys.map(summary);
  },

  /** Returns the plaintext key - the only time it is ever available. */
  async create({ userId, workspaceId, name }) {
    const count = await ApiKey.countDocuments({ userId, revokedAt: null });
    if (count >= MAX_KEYS) {
      throw Object.assign(new Error(`You can have ${MAX_KEYS} keys. Revoke one first.`), { statusCode: 422 });
    }
    const key = KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
    const doc = await ApiKey.create({
      userId,
      workspaceId,
      name,
      prefix: key.slice(0, KEY_PREFIX.length + 6),
      hash: sha256(key),
    });
    return { ...summary(doc), key };
  },

  async revoke(userId, keyId) {
    const key = await ApiKey.findOneAndUpdate(
      { _id: keyId, userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    if (!key) throw Object.assign(new Error("Key not found"), { statusCode: 404 });
    return { id: keyId };
  },

  /** The owner and workspace a key acts for, or null for an unknown, revoked or blocked one. */
  async authenticate(token) {
    if (!token?.startsWith(KEY_PREFIX)) return null;
    const key = await ApiKey.findOne({ hash: sha256(token), revokedAt: null });
    if (!key) return null;
    if (await User.exists({ _id: key.userId, blockedAt: { $ne: null } })) return null;
    // Not awaited: bookkeeping must not slow or fail the request.
    ApiKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    return { userId: String(key.userId), workspaceId: String(key.workspaceId) };
  },
};
