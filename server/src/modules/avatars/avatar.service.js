import { mcpService } from "./mcp.service.js";
import crypto from "node:crypto";
import { avatarRepository } from "./avatar.repository.js";
import { CAPABILITIES, isDevelopmentOnly } from "../../avatar/capabilities.js";
import { isConfigured } from "../../avatar/providers/registry.js";
import { trainingService } from "../../avatar/training.service.js";
import { Persona, TrainingJob } from "../../models/index.js";
import { logger } from "../../config/logger.js";
import { DEFAULT_PROMPT } from "../../ai/prompts/personality.js";
import { knowledgeService } from "./knowledge.service.js";

const notFound = () => {
  const err = new Error("Avatar not found");
  err.statusCode = 404;
  return err;
};

/**
 * 128 random bits. The token is the whole credential for a public link, so it
 * must not be guessable or enumerable - never derived from the avatar id.
 */
const newShareToken = () => crypto.randomBytes(16).toString("base64url");

const shareState = (avatar) => ({
  enabled: Boolean(avatar.share?.enabled && avatar.share?.token),
  token: avatar.share?.token || null,
});

export const avatarService = {
  async list(workspaceId) {
    const avatars = await avatarRepository.listByWorkspace(workspaceId);
    await reconcileTraining(avatars);
    // Re-read only if something actually changed underneath us.
    const fresh = avatars.some((a) => a.status === "training")
      ? await avatarRepository.listByWorkspace(workspaceId)
      : avatars;
    return fresh.map(decorate);
  },

  async get(workspaceId, id) {
    let avatar = await avatarRepository.findById(workspaceId, id);
    if (!avatar) throw notFound();

    if (avatar.status === "training") {
      await reconcileTraining([avatar]);
      avatar = await avatarRepository.findById(workspaceId, id);
    }
    return decorate(avatar);
  },

  /**
   * Edits from the settings page: the avatar's own fields plus its brief.
   *
   * Sent as partial patches while someone types, so only the fields present
   * are touched. An empty string clears an optional field; the brief itself
   * falls back to the default, since a persona cannot be without one.
   */
  async update(workspaceId, id, { name, gender, render, persona }) {
    const avatar = await avatarRepository.findById(workspaceId, id);
    if (!avatar) throw notFound();

    const set = {};
    if (name !== undefined) set.name = name;
    if (gender !== undefined) set.gender = gender;
    for (const [key, value] of Object.entries(render || {})) set[`render.${key}`] = value;
    if (Object.keys(set).length) await avatarRepository.updateById(workspaceId, id, { $set: set });

    if (persona || name !== undefined) {
      const patch = personaPatch(persona || {});
      if (name !== undefined) patch.$set.name = `${name} persona`;

      const empty = !Object.keys(patch.$set).length && !patch.$unset;
      if (avatar.personaId) {
        if (!empty) await Persona.updateOne({ _id: avatar.personaId._id, workspaceId }, patch);
      } else {
        // Avatars from before personas existed get one on first edit.
        const created = await Persona.create({
          workspaceId,
          name: `${name ?? avatar.name} persona`,
          systemPrompt: DEFAULT_PROMPT,
          ...patch.$set,
        });
        await avatarRepository.updateById(workspaceId, id, { $set: { personaId: created._id } });
      }
    }

    return this.get(workspaceId, id);
  },

  /** The avatar's public link: whether it is on, and its token. */
  async getShare(workspaceId, id) {
    const avatar = await avatarRepository.findById(workspaceId, id);
    if (!avatar) throw notFound();
    return shareState(avatar);
  },

  /**
   * Turns the link on or off. The token is minted on first enable and kept
   * across off/on, so switching a link off for a day does not break every
   * invitation already sent - resetting is the separate, deliberate action.
   */
  async setShare(workspaceId, id, { enabled }) {
    const avatar = await avatarRepository.findById(workspaceId, id);
    if (!avatar) throw notFound();

    const patch = { "share.enabled": enabled };
    if (enabled && !avatar.share?.token) patch["share.token"] = newShareToken();

    return shareState(await avatarRepository.updateById(workspaceId, id, { $set: patch }));
  },

  /** Replaces the token, so every copy of the old link stops working at once. */
  async resetShare(workspaceId, id) {
    const updated = await avatarRepository.updateById(workspaceId, id, {
      $set: { "share.token": newShareToken(), "share.enabled": true },
    });
    if (!updated) throw notFound();
    return shareState(updated);
  },

  async remove(workspaceId, id) {
    const deleted = await avatarRepository.deleteById(workspaceId, id);
    if (!deleted) throw notFound();
    await knowledgeService.removeAllFor(workspaceId, id);
    await mcpService.removeAllFor(workspaceId, id);
    // The vendor-side avatar is deleted by a queue worker so a slow or failing
    // vendor never blocks the request. Wired up in Phase 2.
    return { id };
  },
};

/** Turns a partial brief into $set / $unset, with blanks meaning "clear". */
function personaPatch(fields) {
  const $set = {};
  const $unset = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === "" || value === null) {
      if (key === "systemPrompt") $set.systemPrompt = DEFAULT_PROMPT;
      else $unset[key] = "";
    } else {
      $set[key] = value;
    }
  }
  return Object.keys($unset).length ? { $set, $unset } : { $set };
}

/**
 * Brings training avatars up to date on read.
 *
 * Webhooks are the fast path, but they can be missed - a deploy, a dropped
 * request, a vendor that never fires one - and an avatar stuck at "training"
 * forever is indistinguishable from a broken product. Reading is the moment
 * someone actually cares about the answer, so it is a cheap place to check.
 *
 * Failures are swallowed: a vendor being slow must not break the avatar list.
 */
async function reconcileTraining(avatars) {
  const training = avatars.filter((a) => a.status === "training");
  if (!training.length) return;

  const jobs = await TrainingJob.find({
    avatarId: { $in: training.map((a) => a._id) },
    status: { $in: ["queued", "running"] },
  })
    .select("_id")
    .lean();

  await Promise.all(
    jobs.map((job) =>
      trainingService
        .reconcile(job._id)
        .catch((err) => logger.warn({ jobId: String(job._id), err: err.message }, "reconcile failed")),
    ),
  );
}

/**
 * Attach the vendor's capabilities to each avatar.
 *
 * The client needs these to decide what to offer - whether to show emotion
 * controls, whether a live image swap is possible - and deriving it here keeps
 * that knowledge out of the UI.
 */
/**
 * Ready is not the same as callable. A vendor with no credential produces
 * avatars that look finished and fail the moment someone dials them.
 */
export function isCallable(avatar) {
  const capabilities = CAPABILITIES[avatar.providerId];
  return (
    avatar.status === "ready" && Boolean(capabilities?.nodePlugin) && isConfigured(avatar.providerId)
  );
}

function decorate(avatar) {
  const capabilities = CAPABILITIES[avatar.providerId] || null;
  const configured = isConfigured(avatar.providerId);

  return {
    ...avatar,
    capabilities,
    callable: isCallable(avatar),
    share: shareState(avatar),
    // Surfaced so the UI can say so. A stub returns the uploaded file as its
    // own preview, which is indistinguishable from a real result unless the
    // product admits which one it is.
    isStub: isDevelopmentOnly(avatar.providerId),
    ...(configured ? {} : { unavailableReason: `${avatar.providerId} is not configured` }),
  };
}
