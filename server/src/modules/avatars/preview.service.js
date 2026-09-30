import crypto from "node:crypto";
import { Avatar } from "../../models/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { CAPABILITIES, isDevelopmentOnly } from "../../avatar/capabilities.js";
import { agentIdOf } from "../../avatar/providers/lemonslice.provider.js";
import { PREVIEW_ROOM_PREFIX, dispatchPreview, livekitConfig } from "../../integrations/livekit/index.js";

/**
 * The short talking clip an avatar card plays on hover.
 *
 * LemonSlice makes one for agents built in its dashboard, but its API has no
 * way to make one for an image, so avatars created here would only ever show
 * a still. Instead, right after an avatar is created, the agent worker is sent
 * into an empty room: it starts the face, says one line, and LiveKit records
 * the avatar's video to R2 - see runPreview in agent/worker.js. The clip lands
 * on the avatar a minute or so later.
 *
 * Everything here is best effort. A clip that cannot be made leaves the
 * avatar exactly as it was - a still on hover - and never fails the create.
 */

// Avatars with a clip being made right now, so a double click or a retry does
// not start a second room for the same face.
const inFlight = new Set();

/** Why this avatar cannot get a generated clip, or null if it can. */
function unsupported(avatar) {
  if (livekitConfig().isDev) return "LiveKit Cloud is not configured";
  if (env.storageDriver !== "r2") return "recordings are uploaded to R2, and storage is not R2";
  if (!CAPABILITIES[avatar.providerId]?.nodePlugin) return `${avatar.providerId} is not rendered by our worker`;
  // A stub draws a placeholder, not a face - nothing worth recording.
  if (isDevelopmentOnly(avatar.providerId)) return `${avatar.providerId} is a development stub with no real face`;
  // A LemonSlice agent already has LemonSlice's own clip.
  if (agentIdOf(avatar)) return "LemonSlice agents come with their own clip";
  if (avatar.status !== "ready") return "the avatar is not ready";
  return null;
}

export const previewService = {
  /**
   * Starts making a clip for an avatar. Resolves once the recording room has
   * been set up, not when the clip exists. `force` remakes an existing clip.
   */
  async request(avatarId, { force = false } = {}) {
    const id = String(avatarId);
    if (inFlight.has(id)) return { started: false, reason: "already being made" };

    const avatar = await Avatar.findById(id).lean();
    if (!avatar) return { started: false, reason: "avatar not found" };
    if (avatar.previewVideoUrl && !force) return { started: false, reason: "already has a clip" };

    const reason = unsupported(avatar);
    if (reason) return { started: false, reason };

    const roomName = `${PREVIEW_ROOM_PREFIX}${id}-${crypto.randomBytes(3).toString("hex")}`;
    inFlight.add(id);
    // Released after the worker has had ample time; the worker itself gives up
    // well before this.
    setTimeout(() => inFlight.delete(id), 3 * 60 * 1000).unref();

    try {
      await dispatchPreview({ roomName, avatarId: id });
      logger.info({ avatarId: id, room: roomName }, "preview clip requested");
      return { started: true };
    } catch (err) {
      inFlight.delete(id);
      logger.warn({ avatarId: id, err: err.message }, "preview clip could not be requested");
      return { started: false, reason: err.message };
    }
  },

  /** Fire-and-forget form for the create flows: never throws, never waits. */
  requestInBackground(avatarId) {
    this.request(avatarId).catch((err) =>
      logger.warn({ avatarId: String(avatarId), err: err.message }, "preview clip request failed"),
    );
  },
};
