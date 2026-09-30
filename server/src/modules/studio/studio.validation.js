import { z } from "zod";
import { isOwnVoice, llmModels, voicesForTts } from "../../ai/catalog.js";

// A voice or model the call pipeline does not know would only fail mid-call,
// so they are refused when saved. No voice list (a TTS model the catalogue does
// not cover) means any name is let through, as before. Custom voices are not
// in the list - they are the workspace's own, cloned in LiveKit Cloud or
// through ElevenLabs.
const knownVoice = (v) => {
  const voices = voicesForTts();
  return !v || isOwnVoice(v) || !voices.length || voices.some((x) => x.id === v);
};
const knownModel = (m) => !m || llmModels().some((x) => x.id === m);

/**
 * How the avatar should behave. Every field optional - there are defaults.
 *
 * Exported bare so the avatar settings page can edit the same fields it was
 * created with; there, an empty string clears a field.
 */
export const behaviourFields = z.object({
  systemPrompt: z.string().trim().max(4000).optional(),
  greeting: z.string().trim().max(400).optional(),
  language: z.string().trim().min(2).max(10).optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  motionPrompt: z.string().trim().max(400).optional(),
  idlePrompt: z.string().trim().max(400).optional(),
  maxCallSeconds: z.coerce.number().int().min(60).max(14400).optional(),
  voice: z.string().trim().max(60).optional().refine(knownVoice, "That voice is not available"),
  voiceSpeed: z.coerce.number().min(0.5).max(1.5).optional(),
  useDefaultPrompt: z.boolean().optional(),
  llmModel: z.string().trim().max(80).optional().refine(knownModel, "That language model is not available"),
});

/**
 * The brief as the create flows receive it.
 *
 * Nested under one key so the three create flows forward it as a unit and
 * cannot drift apart on which fields they happen to pass through.
 */
const behaviour = z.preprocess(
  // The upload flows are multipart, so this arrives as a JSON string there and
  // as an object on the JSON route. Normalise before validating rather than
  // giving the two routes different schemas.
  (value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  },
  behaviourFields.optional(),
);

export const gender = z.enum(["female", "male"]);

const source = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  // Omitted means "let the registry pick the cheapest capable vendor".
  providerId: z.string().trim().min(1).optional(),
  gender: gender.optional(),
  behaviour,
});

export const studioValidation = {
  createFromStock: {
    body: z.object({
      providerId: z.string().trim().min(1),
      providerAvatarId: z.string().trim().min(1),
      // Optional: falls back to the vendor's own name for the avatar.
      name: z.string().trim().max(80).optional(),
      gender: gender.optional(),
      behaviour,
    }),
  },
  setStockGender: {
    body: z.object({
      providerId: z.string().trim().min(1),
      providerAvatarId: z.string().trim().min(1),
      gender,
    }),
  },
  createFromVideo: { body: source },
  // Same fields as video. It used to list only name and provider, and since
  // validation replaces the body, the brief was silently dropped.
  createFromPhoto: { body: source },
};
