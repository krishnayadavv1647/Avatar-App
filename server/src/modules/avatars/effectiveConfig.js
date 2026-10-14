import { KnowledgeDocument } from "../../models/index.js";
import { env } from "../../config/env.js";
import { preflight } from "../../agent/preflight.js";
import {
  LANGUAGES,
  isElevenLabsVoice,
  isHostedModel,
  speedOption,
  ttsModelFor,
  voiceFor,
} from "../../ai/catalog.js";
import { mailConfigured } from "../../integrations/mail/index.js";
import { getRates, rateFor } from "../billing/credit.service.js";

/**
 * An avatar's configuration as a person can verify it.
 *
 * `settings` is what is stored. `effective` is what a call will actually do
 * with it - the two differ more often than they look: a temperature is only
 * honoured by Claude models, a speed only by TTS models that have a speed
 * option, a cloned voice falls back to the default voice when the server has no
 * ElevenLabs key. `warnings` names each such difference, plus language
 * mismatches, and never blocks anything: a deliberately multilingual avatar is
 * legitimate, it just should not be a surprise.
 *
 * This mirrors the worker's own decisions (agent/pipeline.js) without
 * building any speech or model object, so it is cheap and has no side effects.
 */

/** Scripts a language is normally written in. Hindi is often typed in Latin letters, so both pass. */
const SCRIPTS = {
  en: ["latin"], es: ["latin"], fr: ["latin"], de: ["latin"], pt: ["latin"], it: ["latin"], nl: ["latin"],
  hi: ["devanagari", "latin"], ru: ["cyrillic"], uk: ["cyrillic"], bg: ["cyrillic"],
  ja: ["han", "kana"], zh: ["han"], ko: ["hangul"], ar: ["arabic"],
};

const SCRIPT_RANGES = [
  ["cyrillic", /[Ѐ-ӿ]/g],
  ["devanagari", /[ऀ-ॿ]/g],
  ["kana", /[぀-ヿ]/g],
  ["han", /[一-鿿]/g],
  ["hangul", /[가-힯]/g],
  ["arabic", /[؀-ۿ]/g],
  ["latin", /[A-Za-zÀ-ɏ]/g],
];

/** The script most of a text's letters are in, or null when there is too little to say. */
export function dominantScript(text) {
  const sample = String(text || "");
  const counts = SCRIPT_RANGES.map(([name, re]) => [name, (sample.match(re) || []).length]);
  const total = counts.reduce((sum, [, n]) => sum + n, 0);
  if (total < 8) return null;
  const [name, n] = counts.sort((a, b) => b[1] - a[1])[0];
  return n / total >= 0.6 ? name : null;
}

/**
 * Only the greeting is compared: it is what the avatar says aloud first, in the
 * voice and recogniser set for `language`. The instructions are often written
 * in English for an avatar that speaks something else, which is fine.
 */
function languageWarnings(persona, language) {
  const expected = SCRIPTS[language];
  const script = dominantScript(persona?.greeting);
  if (!expected || !script || expected.includes(script)) return [];
  return [
    {
      code: "language_mismatch",
      field: "greeting",
      message:
        `The greeting is written in ${script} script but the avatar's language is "${language}", so speech ` +
        `recognition and the voice are set for the wrong language. Change the language, or ignore this if the ` +
        `avatar is meant to be multilingual.`,
    },
  ];
}

/** The model a call will really run on, mirroring agent/pipeline.js:buildLlm. */
function llmFor(persona) {
  const wanted = persona?.llmModel || (env.anthropicApiKey ? env.defaultLlmModel : null);
  if (wanted && isHostedModel(wanted)) {
    return { model: wanted, provider: "hosted", source: persona?.llmModel ? "avatar" : "install default", temperatureApplied: false };
  }
  if (wanted && env.anthropicApiKey) {
    return { model: wanted, provider: "anthropic", source: persona?.llmModel ? "avatar" : "install default", temperatureApplied: true };
  }
  return {
    model: env.fallbackLlmModel,
    provider: "hosted",
    source: wanted ? `fallback (${wanted} needs ANTHROPIC_API_KEY)` : "fallback (no ANTHROPIC_API_KEY)",
    temperatureApplied: false,
  };
}

/** The voice a call will really speak, mirroring agent/pipeline.js:buildTts. */
function voiceEffective(avatar, persona) {
  const { voice, assigned } = voiceFor({ ...avatar, persona });
  if (isElevenLabsVoice(voice) && !env.elevenlabs.apiKey) {
    return {
      configured: voice,
      spoken: env.ttsVoice,
      model: ttsModelFor(env.ttsVoice),
      substituted: true,
      reason: "This is an ElevenLabs voice and the server has no ELEVENLABS_API_KEY.",
    };
  }
  return {
    configured: assigned ? voice : null,
    spoken: voice,
    model: ttsModelFor(voice),
    substituted: !assigned,
    reason: assigned ? null : "The avatar has no voice of its own, so the install default is used.",
  };
}

/**
 * @param {object} avatar  populated with `personaId`
 * @returns {Promise<{ settings: object, effective: object, warnings: Array<{ code: string, field?: string, message: string }> }>}
 */
export async function describeAvatar(avatar) {
  const persona = avatar.personaId || avatar.persona || {};
  const render = avatar.render || {};
  const language = persona.language || env.sttLanguage;

  const settings = {
    systemPrompt: persona.systemPrompt ?? null,
    greeting: persona.greeting ?? null,
    language: persona.language ?? null,
    voice: persona.voice ?? null,
    voiceSpeed: persona.voiceSpeed ?? null,
    llmModel: persona.llmModel ?? null,
    temperature: persona.temperature ?? null,
    maxCallSeconds: persona.maxCallSeconds ?? null,
    useDefaultPrompt: Boolean(persona.useDefaultPrompt),
    captureLeads: Boolean(persona.captureLeads),
    humanHandoff: Boolean(persona.humanHandoff),
    motionPrompt: persona.motionPrompt ?? null,
    idlePrompt: persona.idlePrompt ?? null,
    render: { aspectRatio: render.aspectRatio || "2x3", model: render.model || "standard" },
  };

  const llm = llmFor(persona);
  const voice = voiceEffective(avatar, persona);
  const speedModel = voice.model;
  const speedApplied = persona.voiceSpeed == null || persona.voiceSpeed === 1 || Boolean(speedOption(speedModel, persona.voiceSpeed));
  const rates = await getRates();

  const documents = await KnowledgeDocument.find({ avatarId: avatar._id }).select("chars").lean();

  const effective = {
    language: { value: language, knownToSpeechModels: LANGUAGES.some((l) => l.code === language) },
    llm: {
      model: llm.model,
      provider: llm.provider,
      source: llm.source,
      temperature: { value: persona.temperature ?? null, applied: llm.temperatureApplied },
    },
    voice: {
      configured: voice.configured,
      spoken: voice.spoken,
      substituted: voice.substituted,
      reason: voice.reason,
      ttsModel: voice.model,
      speed: { value: persona.voiceSpeed ?? null, applied: speedApplied },
    },
    maxCallSeconds: {
      value: persona.maxCallSeconds || env.defaultCallSeconds,
      source: persona.maxCallSeconds ? "avatar" : "install default",
    },
    instructions: { usesRecommendedGuidance: Boolean(persona.useDefaultPrompt) },
    callTools: {
      save_lead: Boolean(persona.captureLeads),
      request_human: Boolean(persona.humanHandoff),
      ownerEmailConfigured: mailConfigured(),
    },
    movement: { motionPrompt: persona.motionPrompt || null, idlePrompt: persona.idlePrompt || null },
    render: { ...settings.render, creditsPerMinute: rateFor(rates, avatar) },
    knowledge: { documents: documents.length, characters: documents.reduce((n, d) => n + (d.chars || 0), 0) },
  };

  const warnings = [];
  const checked = await preflight({ ...avatar, persona, documents });
  for (const message of checked.errors) warnings.push({ code: "call_will_fail", message });
  for (const message of checked.warnings) {
    // Said again, with the voice names, by voice_substituted below.
    if (/ELEVENLABS_API_KEY/.test(message) && voice.substituted) continue;
    warnings.push({ code: "degraded", message });
  }

  if (persona.temperature != null && persona.temperature !== 0.7 && !llm.temperatureApplied) {
    warnings.push({
      code: "temperature_ignored",
      field: "temperature",
      message: `Temperature ${persona.temperature} is only used by Claude models; calls run on ${llm.model}, which uses its own default.`,
    });
  }
  if (!speedApplied) {
    warnings.push({
      code: "voice_speed_ignored",
      field: "voiceSpeed",
      message: `The voice model ${speedModel} has no speed control, so speed ${persona.voiceSpeed} is not applied.`,
    });
  }
  if (voice.substituted && voice.configured) {
    warnings.push({ code: "voice_substituted", field: "voice", message: `${voice.reason} Calls speak "${voice.spoken}" instead of "${voice.configured}".` });
  }
  if (persona.humanHandoff && !mailConfigured()) {
    warnings.push({
      code: "handoff_not_emailed",
      field: "humanHandoff",
      message: "Requests for a person are recorded, but this server has no email set up, so the owner is not emailed. They appear under Leads.",
    });
  }
  warnings.push(...languageWarnings(persona, language));

  return { settings, effective, warnings };
}
