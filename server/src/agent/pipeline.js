import { inference } from "@livekit/agents";
import * as anthropic from "@livekit/agents-plugin-anthropic";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import { livekitConfig } from "../integrations/livekit/index.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
  elevenLabsVoiceId,
  isElevenLabsVoice,
  isHostedModel,
  speedOption,
  ttsModelFor,
  voiceFor,
} from "../ai/catalog.js";

/**
 * Builds the speech and language half of a call.
 *
 * Two independent credentials decide what is possible, and neither implies the
 * other:
 *
 *   LiveKit Cloud    provides Inference - hosted STT and TTS behind the LiveKit
 *                    credential. The self-hosted server does NOT offer it, so
 *                    without Cloud there is no speech at all.
 *
 *   Anthropic key    LiveKit Inference does not carry Claude. Claude is only
 *                    reachable through its own plugin with your own key, so the
 *                    language model is chosen separately from speech.
 *
 * Rather than fail when something is missing, the worker degrades and reports
 * what it degraded to - a mute agent with no explanation is far worse to debug
 * than a loud one.
 *
 * @param {{ voice?: { providerVoiceId?: string, language?: string } }} [avatar]
 */
export function buildPipelineConfig(avatar) {
  const persona = avatar?.persona;
  const cfg = livekitConfig();

  if (cfg.isDev) {
    return {
      available: false,
      reason:
        "LiveKit Inference requires LiveKit Cloud, and this is the self-hosted dev server. " +
        "The agent will publish avatar video without conversation. " +
        "Set LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET to enable speech.",
    };
  }

  const llm = buildLlm(persona);
  const tts = buildTts(avatar);
  const language = persona?.language || env.sttLanguage;

  return {
    available: true,
    stt: new inference.STT({ model: env.sttModel, language }),
    tts: tts.instance,
    llm: llm.instance,
    llmLabel: llm.label,
    ttsLabel: tts.label,
    notes: [llm.note, tts.note].filter(Boolean),
  };
}

/**
 * The persona's model and temperature win over the install defaults.
 *
 * They were stored from the start and then ignored here, so a brief that asked
 * for a different model or a steadier tone quietly got neither.
 *
 * A "provider/model" id is hosted and runs on LiveKit Inference; a bare id is
 * Claude and needs its own key. Temperature is only passed to Claude: some
 * hosted models (OpenAI's reasoning ones) refuse anything but their default.
 */
function buildLlm(persona) {
  const model = persona?.llmModel || (env.anthropicApiKey ? env.defaultLlmModel : null);

  if (model && isHostedModel(model)) {
    return { instance: new inference.LLM({ model }), label: model };
  }

  if (model && env.anthropicApiKey) {
    return {
      instance: new anthropic.LLM({
        model,
        apiKey: env.anthropicApiKey,
        temperature: persona?.temperature,
      }),
      label: model,
    };
  }

  return {
    instance: new inference.LLM({ model: env.fallbackLlmModel }),
    label: env.fallbackLlmModel,
    note: model
      ? `"${model}" needs ANTHROPIC_API_KEY, so using the hosted model "${env.fallbackLlmModel}".`
      : `No ANTHROPIC_API_KEY, so using the hosted model "${env.fallbackLlmModel}". ` +
        `LiveKit Inference does not carry Claude.`,
  };
}

/**
 * Inference TTS requires a voice alongside the model - omitting it fails at
 * call time, not at construction. The avatar's own voice wins when one is set,
 * so a per-avatar voice needs no change here once Phase 2 populates it.
 */
function buildTts(avatar) {
  const persona = avatar?.persona;
  const { voice, assigned } = voiceFor(avatar);
  const language = persona?.language || avatar?.voice?.language || env.sttLanguage;

  if (isElevenLabsVoice(voice)) {
    if (env.elevenlabs.apiKey) return buildElevenLabsTts(voice, language, persona?.voiceSpeed);
    // The clone still exists at ElevenLabs; the call just cannot reach it.
    // Speak with the default voice rather than not at all.
    const fallback = buildTts({ ...avatar, persona: { ...persona, voice: env.ttsVoice } });
    return {
      ...fallback,
      note: `Cloned voice needs ELEVENLABS_API_KEY; using the default "${env.ttsVoice}".`,
    };
  }

  const model = ttsModelFor(voice);
  const modelOptions = speedOption(model, persona?.voiceSpeed);

  return {
    instance: new inference.TTS({
      model,
      voice,
      language,
      ...(modelOptions && { modelOptions }),
    }),
    label: `${model} / ${voice}${modelOptions ? ` @ ${persona.voiceSpeed}x` : ""}`,
    note: assigned ? null : `Avatar has no voice assigned; using the default "${voice}".`,
  };
}

/**
 * A voice the workspace cloned through ElevenLabs, spoken by ElevenLabs'
 * own plugin with the install's key - LiveKit Inference cannot reach clones
 * that live in someone else's ElevenLabs account.
 */
function buildElevenLabsTts(voice, language, speed) {
  const model = env.elevenlabs.model;
  const speedOpt = speedOption(`elevenlabs/${model}`, speed);

  return {
    instance: new elevenlabs.TTS({
      apiKey: env.elevenlabs.apiKey,
      voiceId: elevenLabsVoiceId(voice),
      model,
      language,
      // ElevenLabs' recommended defaults for a clone, plus the persona's speed.
      ...(speedOpt && { voiceSettings: { stability: 0.5, similarity_boost: 0.75, speed: speedOpt.speed } }),
    }),
    label: `elevenlabs/${model} / ${elevenLabsVoiceId(voice)}${speedOpt ? ` @ ${speedOpt.speed}x` : ""}`,
    note: null,
  };
}

export function logPipelineMode(config) {
  if (!config.available) {
    logger.warn({ reason: config.reason }, "pipeline: video only");
    return;
  }
  logger.info({ llm: config.llmLabel, tts: config.ttsLabel }, "pipeline: full conversation");
  for (const note of config.notes || []) logger.warn(note);
}
