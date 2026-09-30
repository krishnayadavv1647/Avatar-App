import { env } from "../config/env.js";

/**
 * What a persona can choose from: voices, language models, and how the face is
 * rendered.
 *
 * One list read by both sides - the studio offers it and the call pipeline
 * honours it - so a setting can never be offered that the call then ignores.
 */

/**
 * Inworld voices, spoken through LiveKit Inference. Only meaningful while the
 * TTS model is an Inworld one; `voicesForTts` says so rather than offering
 * names another vendor will refuse.
 */
const INWORLD_VOICES = [
  { id: "Ashley", gender: "female", description: "Warm, natural" },
  { id: "Olivia", gender: "female", description: "British, composed" },
  { id: "Wendy", gender: "female", description: "Bright, friendly" },
  { id: "Julia", gender: "female", description: "Calm, clear" },
  { id: "Sarah", gender: "female", description: "Confident, upbeat" },
  { id: "Deborah", gender: "female", description: "Mature, gentle" },
  { id: "Elizabeth", gender: "female", description: "Polished, professional" },
  { id: "Priya", gender: "female", description: "Indian English" },
  { id: "Anjali", gender: "female", description: "Indian, soft" },
  { id: "Luna", gender: "female", description: "Airy, youthful" },
  { id: "Pixie", gender: "female", description: "Playful, animated" },
  { id: "Dennis", gender: "male", description: "Smooth, calm, friendly" },
  { id: "Alex", gender: "male", description: "Energetic, expressive" },
  { id: "Edward", gender: "male", description: "Clear, measured" },
  { id: "Mark", gender: "male", description: "Relaxed, conversational" },
  { id: "Timothy", gender: "male", description: "Light, youthful" },
  { id: "Craig", gender: "male", description: "British, warm" },
  { id: "Ronald", gender: "male", description: "Deep, mature" },
  { id: "Theodore", gender: "male", description: "Gravelly, seasoned" },
  { id: "Shaun", gender: "male", description: "Easygoing" },
  { id: "Arjun", gender: "male", description: "Indian, steady" },
  { id: "Hades", gender: "male", description: "Dark, dramatic" },
];

const DEFAULT_VOICE = { female: "Ashley", male: "Dennis" };

export function voicesForTts(model = env.ttsModel) {
  return model.startsWith("inworld/") ? INWORLD_VOICES : [];
}

/**
 * The voice a call actually speaks with: the persona's own, else a legacy Voice
 * record's - but only when it belongs to this TTS model (the seeded
 * "mock-voice-1" would otherwise be sent to Inworld and fail the call) - else
 * the install default. The pipeline and the preflight check both use this, so
 * they can never disagree about what will be spoken.
 */
export function voiceFor(avatar, model = env.ttsModel) {
  const own = avatar?.persona?.voice;
  if (own) return { voice: own, assigned: true };
  const legacy = avatar?.voice;
  if (legacy?.providerVoiceId && model.startsWith(`${legacy.provider}/`)) {
    return { voice: legacy.providerVoiceId, assigned: true };
  }
  return { voice: env.ttsVoice, assigned: false };
}

/**
 * A custom voice cloned in the LiveKit Cloud dashboard, e.g. "v_RT5PsNhXvMaB".
 * It is one id for every provider LiveKit cloned it onto, so it is valid under
 * any TTS model that supports clones rather than belonging to one voice list.
 */
export const isCustomVoice = (id) => typeof id === "string" && /^v_[A-Za-z0-9]{6,40}$/.test(id);

/**
 * The TTS model a voice speaks through. Stock voices use the install's model;
 * custom ones need a model LiveKit clones onto, which the default Inworld one
 * need not be.
 */
export const ttsModelFor = (voice) => {
  if (isElevenLabsVoice(voice)) return `elevenlabs/${env.elevenlabs.model}`;
  return isCustomVoice(voice) ? env.customVoiceTtsModel : env.ttsModel;
};

/**
 * A voice cloned through ElevenLabs, stored on the persona as
 * "elevenlabs:<voice_id>". The prefix keeps it apart from stock and LiveKit
 * voices everywhere a voice is checked, and tells the pipeline to speak it
 * through ElevenLabs rather than LiveKit Inference.
 */
const ELEVENLABS_PREFIX = "elevenlabs:";
export const isElevenLabsVoice = (id) =>
  typeof id === "string" && /^elevenlabs:[A-Za-z0-9]{10,40}$/.test(id);
export const elevenLabsVoiceId = (id) => id.slice(ELEVENLABS_PREFIX.length);
export const toElevenLabsVoice = (voiceId) => `${ELEVENLABS_PREFIX}${voiceId}`;

/** A voice the workspace cloned itself - checked by its provider, not a list. */
export const isOwnVoice = (id) => isCustomVoice(id) || isElevenLabsVoice(id);

/** The voice a new avatar gets for its character, or the install default. */
export function defaultVoiceFor(gender) {
  if (voicesForTts().length && DEFAULT_VOICE[gender]) return DEFAULT_VOICE[gender];
  return env.ttsVoice;
}

/**
 * The speed knob, in whichever option this TTS model calls it. Unknown models
 * get nothing rather than a guessed key the gateway would reject.
 */
export function speedOption(model, speed) {
  if (speed == null || speed === 1) return undefined;
  if (model.startsWith("inworld/")) return { speaking_rate: speed };
  if (/^(cartesia|xai|fishaudio)\//.test(model)) return { speed };
  // ElevenLabs only accepts 0.7-1.2, so the ends of the slider are clamped.
  if (model.startsWith("elevenlabs/")) return { speed: Math.min(1.2, Math.max(0.7, speed)) };
  return undefined;
}

/**
 * Language models. Hosted ones go through LiveKit Inference with the LiveKit
 * credential; Claude needs its own key, because Inference does not carry it.
 */
const HOSTED_LLMS = [
  { id: "google/gemma-4-31b-it", label: "Gemma 4 31B" },
  { id: "openai/gpt-5-mini", label: "GPT-5 mini" },
  { id: "openai/gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "google/gemini-3-flash", label: "Gemini 3 Flash" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "deepseek-ai/deepseek-v3.2", label: "DeepSeek V3.2" },
  { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6" },
  { id: "xai/grok-4-1-fast-non-reasoning", label: "Grok 4.1 Fast" },
];

const CLAUDE_LLMS = [
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

/** Hosted ids are "provider/model"; Claude ids are bare. */
export const isHostedModel = (id) => typeof id === "string" && id.includes("/");

export function llmModels() {
  const claude = Boolean(env.anthropicApiKey);
  return [
    ...CLAUDE_LLMS.map((m) => ({
      ...m,
      available: claude,
      ...(claude ? {} : { unavailableReason: "Needs ANTHROPIC_API_KEY" }),
    })),
    ...HOSTED_LLMS.map((m) => ({ ...m, available: true })),
  ];
}

/** What an avatar with no model of its own runs on. */
export const defaultLlmModel = () =>
  env.anthropicApiKey ? env.defaultLlmModel : env.fallbackLlmModel;

/**
 * Offered languages. Kept server-side so the list cannot drift from what the
 * speech models are actually configured for.
 */
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
];

/** LemonSlice render options, as their session API names them. */
export const RENDER_MODELS = [
  { id: "standard", label: "Standard" },
  { id: "flash", label: "Flash" },
  { id: "lite", label: "Lite" },
];

export const ASPECT_RATIOS = [
  { id: "2x3", label: "2:3" },
  { id: "9x16", label: "9:16" },
  { id: "1x1", label: "1:1" },
];
