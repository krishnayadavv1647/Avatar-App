import { Avatar } from "../../models/index.js";
import { avatarService } from "../avatars/avatar.service.js";
import { previewService } from "../avatars/preview.service.js";
import { usageService } from "../billing/usage.service.js";
import { studioService } from "./studio.service.js";
import { logger } from "../../config/logger.js";

/**
 * The creator's "Preview": see the face actually speak before committing to it.
 *
 * LemonSlice's API cannot animate an image on request, so the only real clip is
 * the one our worker records from a live avatar (see preview.service.js). A
 * preview therefore creates the avatar as a hidden *draft*, asks for that clip,
 * and lets the person keep it (it becomes an ordinary avatar, no second create)
 * or discard it (it is deleted). A draft never appears in any list, and the
 * ones nobody keeps are swept away.
 *
 * It costs what a short call costs, so it is limited and the old draft is
 * discarded before a new one is made - there is at most one per person.
 */
const CLIP_TIMEOUT_MS = 3 * 60 * 1000;
const SWEEP_AFTER_MS = 60 * 60 * 1000;

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

async function draftOf(workspaceId, id) {
  const avatar = /^[0-9a-f]{24}$/i.test(id) ? await Avatar.findOne({ _id: id, workspaceId, draft: true }).lean() : null;
  if (!avatar) throw fail(404, "That preview was not found. It may have been discarded.");
  return avatar;
}

/** Deletes a person's earlier drafts, so previews never pile up. */
async function discardOld(workspaceId, userId) {
  const old = await Avatar.find({ workspaceId, createdBy: userId, draft: true }).select("_id").lean();
  for (const { _id } of old) await avatarService.remove(workspaceId, _id).catch(() => {});
}

/** Asks for the clip; if it cannot be made at all, the draft goes and the reason is returned. */
async function requestClip(workspaceId, avatar) {
  const result = await previewService.request(avatar._id, { force: true });
  if (result.started) return { avatarId: String(avatar._id) };

  await avatarService.remove(workspaceId, avatar._id).catch(() => {});
  throw fail(409, `Preview isn't available here: ${result.reason}.`);
}

export const previewDraftService = {
  async fromPhoto({ workspace, userId, file, name, gender, behaviour, providerId }) {
    await discardOld(workspace._id, userId);
    const avatar = await studioService.createFromPhoto({
      workspace,
      file,
      name,
      gender,
      behaviour,
      providerId,
      userId,
      draft: true,
    });
    return requestClip(workspace._id, avatar);
  },

  async fromLibraryFace({ workspace, userId, providerAvatarId, name, gender, behaviour }) {
    await discardOld(workspace._id, userId);
    const avatar = await studioService.createFromStock({
      workspace,
      providerId: "library",
      providerAvatarId,
      name,
      gender,
      behaviour,
      userId,
      draft: true,
    });
    return requestClip(workspace._id, avatar);
  },

  /** `{ status: "making" | "ready" | "failed", url? }` - the clip is a recording, so it appears on its own. */
  async status(workspaceId, id) {
    const avatar = await draftOf(workspaceId, id);
    if (avatar.previewVideoUrl) return { status: "ready", url: avatar.previewVideoUrl };
    if (Date.now() - new Date(avatar.createdAt).getTime() > CLIP_TIMEOUT_MS) {
      return { status: "failed", reason: "The preview took too long to record." };
    }
    return { status: "making" };
  },

  /** The draft becomes an ordinary avatar. */
  async keep(workspace, id) {
    const draft = await draftOf(workspace._id, id);
    // Counted now, as it becomes one of the avatars the plan allows.
    await usageService.assertCanCreateAvatar(workspace);
    await Avatar.updateOne({ _id: draft._id }, { $set: { draft: false } });
    return avatarService.get(workspace._id, draft._id);
  },

  async discard(workspaceId, id) {
    const draft = await draftOf(workspaceId, id);
    await avatarService.remove(workspaceId, draft._id);
    return { id };
  },

  /** Removes drafts nobody kept (a closed tab, a crash). Safe to run any time. */
  async sweep() {
    const stale = await Avatar.find({ draft: true, createdAt: { $lt: new Date(Date.now() - SWEEP_AFTER_MS) } })
      .select("_id workspaceId")
      .lean();
    for (const { _id, workspaceId } of stale) await avatarService.remove(workspaceId, _id).catch(() => {});
    if (stale.length) logger.info({ count: stale.length }, "swept unused preview drafts");
    return stale.length;
  },
};

/** Sweeps every ten minutes. Not started under test. */
export function startDraftSweep() {
  if (process.env.NODE_ENV === "test") return;
  setInterval(() => previewDraftService.sweep().catch(() => {}), 10 * 60 * 1000).unref();
}
