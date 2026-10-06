import crypto from "node:crypto";
import { Avatar, Conversation, User, Workspace } from "../../models/index.js";
import { env } from "../../config/env.js";
import { roomService } from "../rooms/room.service.js";
import { isCallable } from "../avatars/avatar.service.js";
import { fetchPicture } from "../avatars/previewImage.service.js";

/**
 * Public share links: talking to an avatar with nothing but its link.
 *
 * Everything here is reachable without an account, so it is deliberately
 * narrow. A link reveals the avatar's name and picture and nothing else about
 * the workspace; a caller can start a call and end their own call, and cannot
 * read history, transcripts or costs. Starting a call still goes through the
 * workspace's concurrency limit and allowance, so a link cannot spend more
 * than the owner could.
 */

const linkNotActive = () => {
  const err = new Error("This link is not active. Ask whoever sent it for a new one.");
  err.statusCode = 404;
  return err;
};

async function findAvatar(token) {
  const avatar = await Avatar.findOne({ "share.token": token, "share.enabled": true }).lean();
  if (!avatar) throw linkNotActive();
  return avatar;
}

/**
 * Proves the caller ending a call is the one who started it. Stateless - an
 * HMAC of the conversation id - so nothing extra is stored per call.
 */
const callTokenFor = (conversationId) =>
  crypto
    .createHmac("sha256", env.jwt.accessSecret)
    .update(`link-call:${conversationId}`)
    .digest("base64url");

function verifyCallToken(conversationId, presented) {
  const expected = Buffer.from(callTokenFor(conversationId));
  const given = Buffer.from(String(presented));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Whether the workspace owner behind an avatar has been blocked by an admin. */
async function ownerBlocked(avatar) {
  const workspace = await Workspace.findById(avatar.workspaceId).select("ownerId").lean();
  return Boolean(workspace && (await User.exists({ _id: workspace.ownerId, blockedAt: { $ne: null } })));
}

export const linkService = {
  async describe(token) {
    const avatar = await findAvatar(token);
    return {
      avatar: { name: avatar.name, previewUrl: avatar.previewUrl },
      available: isCallable(avatar) && !(await ownerBlocked(avatar)),
    };
  },

  /** The avatar's still picture, same-origin, for the call page's connecting animation. */
  async previewImage(token) {
    return fetchPicture((await findAvatar(token)).previewUrl);
  },

  async startCall(token, { name, email }) {
    const avatar = await findAvatar(token);
    if (!isCallable(avatar)) {
      const err = new Error("This avatar is not available right now. Try again later.");
      err.statusCode = 409;
      throw err;
    }

    const workspace = await Workspace.findById(avatar.workspaceId);
    if (!workspace) throw linkNotActive();

    // A blocked owner's avatars stop taking calls - including from links
    // already handed out. The guest gets the same answer as any unavailable avatar.
    if (await ownerBlocked(avatar)) {
      const err = new Error("This avatar is not available right now. Try again later.");
      err.statusCode = 409;
      throw err;
    }

    try {
      const connection = await roomService.startCall({
        workspace,
        avatarId: avatar._id,
        source: "link",
        guest: { name, ...(email && { email }) },
      });
      return { ...connection, callToken: callTokenFor(connection.conversationId) };
    } catch (err) {
      // The owner's limits are the owner's business. A guest only needs to
      // know to come back later, not how many calls the workspace is running.
      if (err.statusCode === 429 || err.statusCode === 402) {
        const busy = new Error("This avatar is busy right now. Please try again in a few minutes.");
        busy.statusCode = 503;
        throw busy;
      }
      throw err;
    }
  },

  async endCall(token, conversationId, callToken) {
    const avatar = await findAvatar(token);

    // Same answer for a bad token and a call that is not this link's, so the
    // endpoint cannot be used to probe which conversation ids exist.
    const conversation = verifyCallToken(conversationId, callToken)
      ? await Conversation.findOne({ _id: conversationId, avatarId: avatar._id, source: "link" })
      : null;
    if (!conversation) {
      const err = new Error("Call not found");
      err.statusCode = 404;
      throw err;
    }

    const workspace = await Workspace.findById(avatar.workspaceId);
    await roomService.endCall({ workspace, conversationId: conversation._id });
    return { ended: true };
  },
};
