import { Voice } from "../../models/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { elevenLabsVoiceId, toElevenLabsVoice } from "../../ai/catalog.js";

/**
 * The workspace's own voices, from two places:
 *
 *   ElevenLabs   cloned right here: someone uploads or records a sample, it is
 *                sent to ElevenLabs, and the clone's id is kept. The sample
 *                itself is never stored - only ElevenLabs holds it.
 *
 *   LiveKit      LiveKit has no public API for cloning, so that clone is made
 *                in the LiveKit Cloud dashboard and only its v_* id is
 *                registered here.
 *
 * Either way the record is a label: calls speak the id stored on the persona,
 * so deleting one never breaks an avatar already using it mid-call.
 */

const PROVIDERS = ["livekit", "elevenlabs"];
const ELEVENLABS_API = "https://api.elevenlabs.io/v1";

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

async function elevenLabs(path, init) {
  const res = await fetch(`${ELEVENLABS_API}${path}`, {
    ...init,
    headers: { "xi-api-key": env.elevenlabs.apiKey, ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    logger.warn({ status: res.status, detail: data?.detail, path }, "elevenlabs request failed");
    // ElevenLabs puts the reason in detail.message (or detail as a string).
    const detail = typeof data?.detail === "string" ? data.detail : data?.detail?.message;
    const err = fail(detail ? `ElevenLabs: ${detail}` : "ElevenLabs could not process that. Try again.", 502);
    err.upstreamStatus = res.status;
    throw err;
  }
  return data;
}

export const voiceService = {
  /** What the voice UI can offer on this install. */
  capabilities() {
    return { cloning: Boolean(env.elevenlabs.apiKey) };
  },

  list(workspace) {
    return Voice.find({ workspaceId: workspace._id, provider: { $in: PROVIDERS } })
      .sort({ createdAt: -1 })
      .lean();
  },

  /** Registers a voice already cloned in LiveKit Cloud (a v_* id). */
  async create({ workspace, name, voiceId, gender, language }) {
    const existing = await Voice.findOne({
      workspaceId: workspace._id,
      provider: "livekit",
      providerVoiceId: voiceId,
    });
    if (existing) throw fail(`This voice is already added as "${existing.name}"`, 409);

    const voice = await Voice.create({
      workspaceId: workspace._id,
      provider: "livekit",
      providerVoiceId: voiceId,
      name,
      gender,
      ...(language && { language }),
    });
    return voice.toObject();
  },

  /**
   * Clones a voice from an uploaded or recorded sample through ElevenLabs.
   * `file` is multer's in-memory upload; it goes straight to ElevenLabs and is
   * dropped with the request.
   */
  async clone({ workspace, name, description, gender, language, file }) {
    if (!env.elevenlabs.apiKey) throw fail("Voice cloning is not set up: add ELEVENLABS_API_KEY on the server.", 503);
    if (!file) throw fail("Add a recording of the voice.", 422);
    if (!/^(audio|video)\//.test(file.mimetype)) throw fail("That file is not audio. Use MP3, WAV, M4A, OGG or WEBM.", 422);

    const form = new FormData();
    form.append("name", name);
    if (description) form.append("description", description);
    form.append("remove_background_noise", "true");
    form.append(
      "files",
      new Blob([file.buffer], { type: file.mimetype }),
      Buffer.from(file.originalname || "sample", "latin1").toString("utf8"),
    );

    const { voice_id: voiceId } = await elevenLabs("/voices/add", { method: "POST", body: form });

    const voice = await Voice.create({
      workspaceId: workspace._id,
      provider: "elevenlabs",
      providerVoiceId: toElevenLabsVoice(voiceId),
      name,
      gender,
      ...(language && { language }),
    });
    return voice.toObject();
  },

  /**
   * Adds a voice already in the ElevenLabs account - cloned on elevenlabs.io
   * rather than here - by its voice id. ElevenLabs is asked first, so a typo
   * or a voice from some other account is refused now rather than mid-call.
   */
  async importElevenLabs({ workspace, voiceId, name, gender, language }) {
    if (!env.elevenlabs.apiKey) throw fail("ElevenLabs is not set up: add ELEVENLABS_API_KEY on the server.", 503);

    const providerVoiceId = toElevenLabsVoice(voiceId);
    const existing = await Voice.findOne({ workspaceId: workspace._id, provider: "elevenlabs", providerVoiceId });
    if (existing) throw fail(`This voice is already added as "${existing.name}"`, 409);

    let found;
    try {
      found = await elevenLabs(`/voices/${encodeURIComponent(voiceId)}`);
    } catch (err) {
      if (err.upstreamStatus === 400 || err.upstreamStatus === 404) {
        throw fail("ElevenLabs has no voice with that ID in this account", 404);
      }
      throw err;
    }

    const voice = await Voice.create({
      workspaceId: workspace._id,
      provider: "elevenlabs",
      providerVoiceId,
      name: name || found.name || "ElevenLabs voice",
      gender: gender || (["female", "male"].includes(found.labels?.gender) ? found.labels.gender : undefined),
      imported: true,
      ...(language && { language }),
    });
    return voice.toObject();
  },

  async remove({ workspace, voiceId }) {
    const voice = await Voice.findOne({ _id: voiceId, workspaceId: workspace._id, provider: { $in: PROVIDERS } });
    if (!voice) throw fail("Voice not found", 404);

    // Removing a clone here removes it at ElevenLabs too, so the person's voice
    // is not left behind in the account. Best effort: if ElevenLabs already
    // lost it, or the key has changed, the record still goes.
    if (voice.provider === "elevenlabs" && !voice.imported && env.elevenlabs.apiKey) {
      await elevenLabs(`/voices/${encodeURIComponent(elevenLabsVoiceId(voice.providerVoiceId))}`, {
        method: "DELETE",
      }).catch((err) => logger.warn({ err: err.message, voiceId }, "elevenlabs voice not deleted"));
    }

    await voice.deleteOne();
  },
};
