import { CAPABILITIES } from "../avatar/capabilities.js";
import { isConfigured } from "../avatar/providers/registry.js";
import { env } from "../config/env.js";
import {
  LANGUAGES,
  isElevenLabsVoice,
  isHostedModel,
  isOwnVoice,
  llmModels,
  voiceFor,
  voicesForTts,
} from "../ai/catalog.js";
import { CONTEXT_BUDGET_CHARS } from "../ai/knowledge.js";
import { agentIdOf } from "../avatar/providers/lemonslice.provider.js";

/**
 * Everything about an avatar that would stop - or quietly degrade - a call,
 * found before anyone dials it.
 *
 * Used by the worker at the start of every call, so a bad setting ends the
 * call with a reason instead of leaving the caller on "Connecting...", and by
 * `npm run check:avatars` to audit every avatar at once. `errors` stop a
 * call; `warnings` let it run with something less than what was asked for.
 *
 * `network: true` also checks that an image-based avatar's picture can be
 * fetched - worth it in the audit, not on the call path.
 *
 * @param {object} avatar  with `persona` (and optionally `documents`) resolved
 * @returns {Promise<{ errors: string[], warnings: string[] }>}
 */
export async function preflight(avatar, { network = false } = {}) {
  const errors = [];
  const warnings = [];
  const persona = avatar.persona || avatar.personaId || null;
  const caps = CAPABILITIES[avatar.providerId];

  // Who draws the face.
  if (!caps) errors.push(`Unknown avatar provider "${avatar.providerId}".`);
  else if (!caps.nodePlugin) errors.push(`${avatar.providerId} cannot run in this Node worker.`);
  if (caps && !isConfigured(avatar.providerId)) {
    errors.push(`${avatar.providerId} has no API key configured on the server.`);
  }
  if (avatar.status !== "ready") errors.push(`The avatar is "${avatar.status}", not ready.`);

  // What it looks like.
  if (avatar.providerId === "lemonslice" && !agentIdOf(avatar)) {
    const source = avatar.providerAvatarId || avatar.previewUrl;
    let url = null;
    try {
      url = new URL(source);
    } catch {
      errors.push("The avatar has no usable image address.");
    }
    if (url && network) {
      const problem = await imageProblem(url.href);
      if (problem) errors.push(problem);
    }
  }

  if (!persona) {
    warnings.push("No behaviour saved; the call uses the built-in default brief.");
    return { errors, warnings };
  }

  // What it sounds like.
  const voices = voicesForTts();
  const { voice } = voiceFor({ ...avatar, persona });
  // A custom voice is checked by its provider when the call speaks, not by any list here.
  if (!isOwnVoice(voice) && voices.length && !voices.some((v) => v.id === voice)) {
    errors.push(`Voice "${voice}" is not a voice of the TTS model ${env.ttsModel}.`);
  }
  if (isElevenLabsVoice(voice) && !env.elevenlabs.apiKey) {
    warnings.push(`The cloned voice needs ELEVENLABS_API_KEY; calls fall back to "${env.ttsVoice}".`);
  }
  if (persona.voiceSpeed != null && (persona.voiceSpeed < 0.5 || persona.voiceSpeed > 1.5)) {
    errors.push(`Voice speed ${persona.voiceSpeed} is outside 0.5-1.5.`);
  }

  const language = persona.language || env.sttLanguage;
  if (!LANGUAGES.some((l) => l.code === language)) {
    warnings.push(`Language "${language}" is not one the speech models are set up for; recognition may fail.`);
  }

  // What it thinks with.
  if (persona.llmModel) {
    const known = llmModels().find((m) => m.id === persona.llmModel);
    if (!known) errors.push(`Language model "${persona.llmModel}" is not one this server offers.`);
    else if (!known.available) {
      warnings.push(`${known.label} needs ANTHROPIC_API_KEY; calls fall back to ${env.fallbackLlmModel}.`);
    } else if (!isHostedModel(persona.llmModel) && !env.anthropicApiKey) {
      warnings.push(`Calls fall back to ${env.fallbackLlmModel}.`);
    }
  }

  if (!persona.systemPrompt?.trim()) warnings.push("The brief is empty; a default one is used.");

  // What it knows.
  const chars = (avatar.documents || []).reduce((sum, d) => sum + (d.text?.length || d.chars || 0), 0);
  if (chars > CONTEXT_BUDGET_CHARS) {
    warnings.push(
      `Knowledge documents total ${chars.toLocaleString()} characters; only the first ` +
        `${CONTEXT_BUDGET_CHARS.toLocaleString()} reach a call.`,
    );
  }

  return { errors, warnings };
}

async function imageProblem(href) {
  let res;
  try {
    res = await fetch(href, { method: "HEAD", signal: AbortSignal.timeout(8000) });
  } catch (err) {
    return `The avatar's image could not be reached (${err.message}).`;
  }
  if (!res.ok) return `The avatar's image returned ${res.status}.`;
  const type = res.headers.get("content-type") || "";
  if (!type.startsWith("image/")) return `The avatar's image is "${type || "no content-type"}", not an image.`;
  return null;
}
