import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { User, Workspace } from "../../models/index.js";
import { getStorage } from "../../integrations/storage/registry.js";
import { issueTokens, publicUser } from "../auth/auth.service.js";
import { logger } from "../../config/logger.js";

const ROUNDS = 12;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const fail = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, ...(code && { code }) });

/** What the bytes really are, from their first few: a file's claimed type is only a claim. */
function imageType(buffer) {
  if (buffer.length > 12) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: "image/png", ext: "png" };
    if (buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") return { type: "image/webp", ext: "webp" };
  }
  return null;
}

export const isTimezone = (zone) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

async function loadPerson(userId) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw fail(401, "Authentication required");
  return user;
}

const present = (user, workspace) => ({
  id: String(user._id),
  name: user.name || "",
  email: user.email,
  role: user.role,
  title: user.title || "",
  phone: user.phone || "",
  timezone: user.timezone || "",
  photoUrl: user.photoUrl || null,
  // Whether a password is set, so the page knows to ask for the current one. Never the hash.
  hasPassword: Boolean(user.passwordHash),
  googleLinked: Boolean(user.googleId),
  lastLoginAt: user.lastLoginAt || null,
  createdAt: user.createdAt,
  workspace: workspace ? { id: String(workspace._id), name: workspace.name } : null,
});

export const profileService = {
  async get(userId, workspace) {
    return present(await loadPerson(userId), workspace);
  },

  async update(userId, workspace, { name, title, phone, timezone, workspaceName }) {
    const user = await loadPerson(userId);
    if (timezone && !isTimezone(timezone)) throw fail(422, "That time zone is not recognised.");

    if (name !== undefined) user.name = name;
    if (title !== undefined) user.title = title;
    if (phone !== undefined) user.phone = phone;
    if (timezone !== undefined) user.timezone = timezone;
    await user.save();

    if (workspaceName !== undefined) {
      if (user.role !== "owner") throw fail(403, "Only the workspace owner can rename it.");
      workspace.name = workspaceName;
      await workspace.save();
    }
    return present(user, workspace);
  },

  async setPhoto(userId, workspace, file) {
    if (!file) throw fail(422, "Choose a picture.");
    if (file.size > MAX_PHOTO_BYTES) throw fail(422, "That picture is over 5 MB.");
    const kind = imageType(file.buffer);
    if (!kind) throw fail(422, "Use a JPG, PNG or WebP picture.");

    const user = await loadPerson(userId);
    const stored = await getStorage().put({
      buffer: file.buffer,
      key: `${workspace._id}/profile/${userId}-${crypto.randomUUID()}.${kind.ext}`,
      contentType: kind.type,
    });
    const old = user.photoKey;
    user.photoUrl = stored.publicUrl;
    user.photoKey = stored.storageKey;
    await user.save();
    if (old) await getStorage().remove(old).catch((err) => logger.warn({ err: err.message }, "could not remove an old profile picture"));
    return present(user, workspace);
  },

  async removePhoto(userId, workspace) {
    const user = await loadPerson(userId);
    const old = user.photoKey;
    user.photoUrl = undefined;
    user.photoKey = undefined;
    await user.save();
    if (old) await getStorage().remove(old).catch((err) => logger.warn({ err: err.message }, "could not remove a profile picture"));
    return present(user, workspace);
  },

  /**
   * Changes the password. Someone with a password must give the current one; an
   * account made through Google has none and may set its first. Every other
   * device is signed out (the refresh tokens are versioned), and this one is
   * handed fresh tokens so it stays in.
   */
  async changePassword(userId, { currentPassword, newPassword }) {
    const user = await loadPerson(userId);

    if (user.passwordHash) {
      if (!currentPassword) throw fail(422, "Enter your current password.");
      if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw fail(422, "Your current password is not right.");
      if (currentPassword === newPassword) throw fail(422, "Choose a password that is different from the current one.");
    }

    user.passwordHash = await bcrypt.hash(newPassword, ROUNDS);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    return { ok: true, user: publicUser(user), ...issueTokens(user) };
  },
};
