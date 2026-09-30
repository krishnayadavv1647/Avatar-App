import crypto from "node:crypto";
import path from "node:path";
import { Avatar, AvatarAsset, Persona, Workspace } from "../../models/index.js";
import {
  availableProviderIds,
  getProvider,
  isConfigured,
  selectProvider,
} from "../../avatar/providers/registry.js";
import { getStorage } from "../../integrations/storage/registry.js";
import {
  CAPABILITIES,
  hasStockAvatars,
  isDevelopmentOnly,
  requiresPublicUrl,
} from "../../avatar/capabilities.js";
import { trainingService } from "../../avatar/training.service.js";
import { FACE_LIBRARY, findFace, libraryStock } from "../../avatar/faceLibrary.js";
import { previewService } from "../avatars/preview.service.js";
import { usageService } from "../billing/usage.service.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { DEFAULT_PROMPT } from "../../ai/prompts/personality.js";
import {
  ASPECT_RATIOS,
  LANGUAGES,
  RENDER_MODELS,
  defaultLlmModel,
  defaultVoiceFor,
  llmModels,
  voicesForTts,
} from "../../ai/catalog.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/**
 * Creating an avatar from a photo, in the order the constraints demand.
 *
 * The upload has to be stored and made publicly addressable *before* the vendor
 * is called, because vendors fetch the image themselves rather than receiving
 * bytes from us. Doing it the other way round - register, then upload - is the
 * obvious sequence and does not work.
 */
/**
 * Behaviour is stored as a Persona rather than on the Avatar.
 *
 * The same brief is worth reusing across faces - and the split matters at call
 * time, because a render-only vendor gets the prompt via our language model
 * while a full-pipeline vendor gets it in its own session payload. One field on
 * the avatar would have hidden that difference.
 */
async function createPersona({ workspace, name, behaviour = {}, gender }) {
  const {
    systemPrompt,
    greeting,
    language,
    temperature,
    motionPrompt,
    idlePrompt,
    maxCallSeconds,
    voice,
    voiceSpeed,
    useDefaultPrompt,
    llmModel,
  } = behaviour;

  return Persona.create({
    workspaceId: workspace._id,
    name: `${name} persona`,
    systemPrompt: systemPrompt?.trim() || DEFAULT_PROMPT,
    greeting: greeting?.trim() || undefined,
    language: language || undefined,
    temperature: temperature ?? undefined,
    motionPrompt: motionPrompt?.trim() || undefined,
    idlePrompt: idlePrompt?.trim() || undefined,
    maxCallSeconds: maxCallSeconds || undefined,
    // A character with a gender starts with a voice to match.
    voice: voice?.trim() || (gender ? defaultVoiceFor(gender) : undefined),
    voiceSpeed: voiceSpeed ?? undefined,
    useDefaultPrompt: useDefaultPrompt ?? undefined,
    llmModel: llmModel?.trim() || undefined,
  });
}

/** Whether some configured vendor can turn a photo into an avatar. */
function photoVendorAvailable() {
  try {
    selectProvider({ sourceType: "photo" });
    return true;
  } catch {
    return false;
  }
}

/**
 * A face from the built-in Library becomes an ordinary photo avatar: the same
 * vendor and the same call as an upload, except the picture is already public
 * on Unsplash's CDN, so nothing is stored. Only ids from the Library list are
 * accepted, never a URL from the request.
 */
async function createFromLibraryFace({ workspace, faceId, name, gender, behaviour, userId }) {
  const face = findFace(faceId);
  if (!face) throw unprocessable(`"${faceId}" is not one of the Library faces`);

  const provider = selectProvider({ sourceType: "photo" });
  const resolvedName = name?.trim() || face.name;
  const resolvedGender = gender || face.gender;

  const created = await provider.createFromPhoto({ imageUrl: face.url, name: resolvedName });
  const persona = await createPersona({ workspace, name: resolvedName, behaviour, gender: resolvedGender });

  const avatar = await Avatar.create({
    workspaceId: workspace._id,
    name: resolvedName,
    gender: resolvedGender,
    sourceType: "photo",
    status: created.status === "ready" ? "ready" : "training",
    providerId: provider.id,
    providerAvatarId: created.providerAvatarId,
    previewUrl: created.previewUrl || face.url,
    personaId: persona._id,
    createdBy: userId,
  });

  logger.info({ avatarId: avatar.id, provider: provider.id, face: face.id }, "avatar created from library face");
  previewService.requestInBackground(avatar._id);
  return { ...avatar.toObject(), capabilities: CAPABILITIES[provider.id] };
}

/** Where a ready-made face's gender is recorded on the workspace. */
const stockKey = (providerId, providerAvatarId) =>
  // Map keys cannot contain dots.
  `${providerId}:${providerAvatarId}`.replace(/\./g, "_");

export const studioService = {
  async createFromPhoto({ workspace, file, name, providerId, gender, behaviour, userId }) {
    assertUsableImage(file);
    await usageService.assertCanCreateAvatar(workspace);

    const storage = getStorage();
    const provider = selectProvider({ sourceType: "photo", preferred: providerId });

    assertStorageServes(provider.id, storage);

    const key = `${workspace._id}/avatars/${crypto.randomUUID()}${extensionFor(file)}`;
    const stored = await storage.put({
      buffer: file.buffer,
      key,
      contentType: file.mimetype,
    });

    const asset = await AvatarAsset.create({
      workspaceId: workspace._id,
      kind: "image",
      storageKey: stored.storageKey,
      publicUrl: stored.publicUrl,
      bytes: stored.bytes,
      mime: file.mimetype,
      checksum: crypto.createHash("sha256").update(file.buffer).digest("hex"),
      uploadedBy: userId,
    });

    let created;
    try {
      created = await provider.createFromPhoto({ imageUrl: stored.publicUrl, name });
    } catch (err) {
      // The vendor rejected it; the orphaned upload is not worth keeping.
      await storage.remove(stored.storageKey).catch(() => {});
      await AvatarAsset.deleteOne({ _id: asset._id });
      throw err;
    }

    const persona = await createPersona({ workspace, name, behaviour, gender });

    const avatar = await Avatar.create({
      workspaceId: workspace._id,
      name,
      gender,
      sourceType: "photo",
      status: created.status === "ready" ? "ready" : "training",
      providerId: provider.id,
      providerAvatarId: created.providerAvatarId,
      assetId: asset._id,
      previewUrl: created.previewUrl || stored.publicUrl,
      personaId: persona._id,
      createdBy: userId,
    });

    logger.info(
      { avatarId: avatar.id, provider: provider.id, storage: storage.id },
      "avatar created from photo",
    );
    // The hover clip is made in the background; the create does not wait.
    previewService.requestInBackground(avatar._id);

    return { ...avatar.toObject(), capabilities: CAPABILITIES[provider.id] };
  },

  /**
   * Video-cloned avatars.
   *
   * Unlike a photo avatar, this cannot finish inside the request - training
   * takes minutes on the vendor's side. The avatar is created in a `training`
   * state with a job attached, and resolves later via webhook or poll.
   */
  async createFromVideo({ workspace, file, name, providerId, gender, behaviour, userId }) {
    assertUsableVideo(file);
    await usageService.assertCanCreateAvatar(workspace);

    const storage = getStorage();
    const provider = selectProvider({ sourceType: "video", preferred: providerId });

    assertStorageServes(provider.id, storage);

    const key = `${workspace._id}/training/${crypto.randomUUID()}${extensionFor(file)}`;
    const stored = await storage.put({ buffer: file.buffer, key, contentType: file.mimetype });

    const asset = await AvatarAsset.create({
      workspaceId: workspace._id,
      kind: "video",
      storageKey: stored.storageKey,
      publicUrl: stored.publicUrl,
      bytes: stored.bytes,
      mime: file.mimetype,
      checksum: crypto.createHash("sha256").update(file.buffer).digest("hex"),
      uploadedBy: userId,
    });

    const persona = await createPersona({ workspace, name, behaviour, gender });

    const avatar = await Avatar.create({
      workspaceId: workspace._id,
      name,
      gender,
      sourceType: "video",
      status: "training",
      providerId: provider.id,
      assetId: asset._id,
      personaId: persona._id,
      createdBy: userId,
    });

    // The job exists before the vendor is called so its id can be signed into
    // the callback URL - the vendor needs somewhere to report back to.
    const job = await trainingService.createJob({
      avatarId: avatar._id,
      providerId: provider.id,
      providerJobId: "pending",
    });

    try {
      const started = await provider.createFromVideo({
        videoUrl: stored.publicUrl,
        name,
        callbackUrl: trainingService.callbackUrlFor(job),
      });

      job.providerJobId = started.providerJobId;
      job.status = started.status === "running" ? "running" : "queued";
      await job.save();
    } catch (err) {
      await storage.remove(stored.storageKey).catch(() => {});
      await AvatarAsset.deleteOne({ _id: asset._id });
      await Avatar.deleteOne({ _id: avatar._id });
      await Persona.deleteOne({ _id: persona._id });
      await job.deleteOne();
      throw err;
    }

    logger.info(
      { avatarId: avatar.id, jobId: job.id, provider: provider.id },
      "avatar training started from video",
    );

    return {
      ...avatar.toObject(),
      capabilities: CAPABILITIES[provider.id],
      trainingJobId: job.id,
    };
  },

  /**
   * Ready-made avatars from every vendor that has them.
   *
   * Kept separate from the upload flows because nothing is uploaded and nothing
   * is trained - and because on plans where training is a paid feature, this is
   * the only route to a working avatar.
   */
  async listStock(workspace) {
    // Same rule as the provider list: a stub's catalogue is development
    // furniture, and its entries point at URLs that do not resolve. Letting
    // them into the picker puts broken tiles in front of real users.
    const stubMode = isDevelopmentOnly(env.avatarProvider);

    const providers = availableProviderIds().filter(
      (id) => hasStockAvatars(id) && (stubMode || !isDevelopmentOnly(id)),
    );

    const groups = await Promise.all(
      providers.map(async (id) => {
        try {
          const avatars = await getProvider(id).listStockAvatars();
          return avatars.map((a) => ({ ...a, providerId: id }));
        } catch (err) {
          // One vendor being unreachable should not empty the whole picker.
          logger.warn({ provider: id, err: err.message }, "stock avatar listing failed");
          return [];
        }
      }),
    );

    // Untagged faces come back with no gender and appear under both.
    const vendorStock = groups.flat().map((a) => ({
      ...a,
      gender: workspace?.stockGenders?.get(stockKey(a.providerId, a.providerAvatarId)) || null,
    }));

    // The built-in face library follows the vendor's own characters, already
    // tagged, so the picker is never empty. It needs a vendor that makes photo
    // avatars; without one, picking a face would only fail.
    return photoVendorAvailable() ? [...vendorStock, ...libraryStock()] : vendorStock;
  },

  /** Records whether a ready-made face is a female or male character. */
  async setStockGender({ workspace, providerId, providerAvatarId, gender }) {
    await Workspace.updateOne(
      { _id: workspace._id },
      { $set: { [`stockGenders.${stockKey(providerId, providerAvatarId)}`]: gender } },
    );
    return { providerId, providerAvatarId, gender };
  },

  /**
   * Adopts one of those into this workspace.
   *
   * The vendor already owns the avatar, so this only records that we are using
   * it. Deleting it later must therefore not delete anything on their side -
   * it is not ours to remove.
   */
  async createFromStock({ workspace, providerId, providerAvatarId, name, gender, behaviour, userId }) {
    await usageService.assertCanCreateAvatar(workspace);
    if (providerId === FACE_LIBRARY) {
      return createFromLibraryFace({ workspace, faceId: providerAvatarId, name, gender, behaviour, userId });
    }
    if (!hasStockAvatars(providerId)) {
      throw unprocessable(`Provider "${providerId}" has no ready-made avatars`);
    }
    if (!isConfigured(providerId)) {
      throw unprocessable(`Provider "${providerId}" has no API key configured`);
    }

    const stock = await getProvider(providerId).listStockAvatars();
    const chosen = stock.find((a) => a.providerAvatarId === providerAvatarId);
    if (!chosen) {
      throw unprocessable(`"${providerAvatarId}" is not one of ${providerId}'s avatars`);
    }

    const resolvedName = name?.trim() || chosen.name;
    const resolvedGender =
      gender || workspace.stockGenders?.get(stockKey(providerId, providerAvatarId)) || undefined;

    // The vendor's own settings for this face - its brief, language, pacing -
    // are the starting point; anything sent with the request wins over them.
    const described = await getProvider(providerId)
      .describeStockAvatar?.(providerAvatarId)
      .catch((err) => {
        logger.warn({ providerId, providerAvatarId, err: err.message }, "stock avatar details unavailable");
        return null;
      });

    const persona = await createPersona({
      workspace,
      name: resolvedName,
      behaviour: { ...described?.behaviour, ...behaviour },
      gender: resolvedGender,
    });

    const avatar = await Avatar.create({
      workspaceId: workspace._id,
      name: resolvedName,
      gender: resolvedGender,
      render: described?.render,
      sourceType: "stock",
      status: "ready",
      providerId,
      providerAvatarId,
      previewUrl: chosen.previewUrl,
      previewVideoUrl: chosen.previewVideoUrl,
      personaId: persona._id,
      createdBy: userId,
    });

    logger.info({ avatarId: avatar.id, providerId, providerAvatarId }, "stock avatar adopted");

    return { ...avatar.toObject(), capabilities: CAPABILITIES[providerId] };
  },

  /**
   * What the studio can offer right now. The client renders from this rather
   * than from a hardcoded list, so a vendor that is configured but unusable
   * never appears as a choice.
   */
  options() {
    const storage = getStorage();

    // Stubs are development tooling, not a product choice. Listing one beside
    // real vendors is an invitation to pick it - which is exactly what happened,
    // and the result was an avatar that generated nothing. It appears only when
    // the operator has explicitly put this install into stub mode.
    const stubMode = isDevelopmentOnly(env.avatarProvider);

    return {
      storage: { driver: storage.id, reachableByVendors: storage.reachableByVendors },
      stubMode,
      providers: Object.entries(CAPABILITIES)
        .filter(([id, caps]) => caps.nodePlugin && (caps.photoAvatar || caps.videoClone))
        .filter(([id]) => stubMode || !isDevelopmentOnly(id))
        .map(([id, caps]) => ({
          id,
          costPerMinUsd: caps.approxCostPerMinUsd,
          photoAvatar: caps.photoAvatar,
          videoClone: caps.videoClone,
          nonHumanCharacters: caps.nonHumanCharacters,
          emotions: caps.emotions,
          // Only vendors that fetch assets themselves need public storage.
          acceptsDirectUpload: caps.acceptsDirectUpload,
          configured: isConfigured(id),
          developmentOnly: isDevelopmentOnly(id),
          stockAvatars: caps.stockAvatars,
          usable:
            isConfigured(id) && (storage.reachableByVendors || caps.acceptsDirectUpload),
        })),
      defaultPrompt: DEFAULT_PROMPT,
      languages: LANGUAGES,
      // Empty when the TTS model is not one the catalogue knows; the settings
      // page then offers only the install default.
      voices: voicesForTts(),
      defaultVoice: defaultVoiceFor(),
      defaultVoices: { female: defaultVoiceFor("female"), male: defaultVoiceFor("male") },
      llmModels: llmModels(),
      defaultLlmModel: defaultLlmModel(),
      renderModels: RENDER_MODELS,
      aspectRatios: ASPECT_RATIOS,
      limits: {
        photo: { maxBytes: MAX_IMAGE_BYTES, types: [...ALLOWED_IMAGE_TYPES] },
        video: { maxBytes: MAX_VIDEO_BYTES, types: [...ALLOWED_VIDEO_TYPES] },
      },
    };
  },
};

/**
 * A vendor that fetches assets from its own servers cannot be pointed at
 * localhost. One that accepts the bytes directly does not care where they live,
 * so the check is on the vendor's needs rather than on the driver alone.
 */
function assertStorageServes(providerId, storage) {
  if (!requiresPublicUrl(providerId) || storage.reachableByVendors) return;

  throw unprocessable(
    `${providerId} fetches uploads from its own servers, and storage driver ` +
      `"${storage.id}" produces URLs it cannot reach. Set STORAGE_DRIVER=r2, ` +
      `or expose this API and set PUBLIC_BASE_URL.`,
  );
}

function assertUsableImage(file) {
  if (!file) throw unprocessable("No image uploaded");
  if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
    throw unprocessable(
      `Unsupported image type "${file.mimetype}". Allowed: ${[...ALLOWED_IMAGE_TYPES].join(", ")}`,
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw unprocessable(`Image is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 10 MB`);
  }
}

function assertUsableVideo(file) {
  if (!file) throw unprocessable("No video uploaded");
  if (!ALLOWED_VIDEO_TYPES.has(file.mimetype)) {
    throw unprocessable(
      `Unsupported video type "${file.mimetype}". Allowed: ${[...ALLOWED_VIDEO_TYPES].join(", ")}`,
    );
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw unprocessable(`Video is ${(file.size / 1024 / 1024).toFixed(0)} MB; the limit is 200 MB`);
  }
}

function extensionFor(file) {
  const fromName = path.extname(file.originalname || "").toLowerCase();
  if (fromName) return fromName;
  return (
    {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "video/mp4": ".mp4",
      "video/quicktime": ".mov",
      "video/webm": ".webm",
    }[file.mimetype] || ""
  );
}

function unprocessable(message) {
  const err = new Error(message);
  err.statusCode = 422;
  return err;
}
