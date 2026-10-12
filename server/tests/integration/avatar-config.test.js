/**
 * An avatar's configuration readback: what is stored, what a call will really
 * do with it, and the warnings that name the difference.
 */
import "../setup-env.js";
import test, { after, afterEach, before, describe } from "node:test";
import assert from "node:assert/strict";
import { env } from "../../src/config/env.js";
import { dominantScript } from "../../src/modules/avatars/effectiveConfig.js";
import { instructionsFor } from "../../src/agent/instructions.js";
import { signUp, startTestApp } from "../helpers.js";

let app;
let user;
const saved = {};

before(async () => {
  app = await startTestApp({ seed: false });
  user = await signUp(app.baseUrl);
  Object.assign(saved, { ttsModel: env.ttsModel, anthropic: env.anthropicApiKey, eleven: env.elevenlabs.apiKey });
});

after(() => app.stop());

afterEach(() => {
  env.ttsModel = saved.ttsModel;
  env.anthropicApiKey = saved.anthropic;
  env.elevenlabs.apiKey = saved.eleven;
});

async function newAvatar(persona = {}) {
  const { body } = await user.post("/api/studio/stock", {
    providerId: "library",
    providerAvatarId: "face_f01",
    name: "Config test",
    behaviour: persona,
  });
  return body.avatar._id;
}

const config = async (id) => (await user.get(`/api/avatars/${id}/config`)).body;
const codes = (c) => c.warnings.map((w) => w.code);

describe("GET /api/avatars/:id/config", () => {
  test("returns every stored setting, including the ones the avatar summary leaves out", async () => {
    const id = await newAvatar({
      systemPrompt: "You are a receptionist.",
      greeting: "Hello!",
      temperature: 0.4,
      voiceSpeed: 0.9,
      maxCallSeconds: 600,
      idlePrompt: "waiting calmly",
      motionPrompt: "talking warmly",
      useDefaultPrompt: true,
    });
    const { settings, effective } = await config(id);

    assert.equal(settings.temperature, 0.4);
    assert.equal(settings.voiceSpeed, 0.9);
    assert.equal(settings.maxCallSeconds, 600);
    assert.equal(settings.idlePrompt, "waiting calmly");
    assert.equal(settings.motionPrompt, "talking warmly");
    assert.equal(settings.useDefaultPrompt, true);
    assert.equal(settings.render.aspectRatio, "2x3");

    assert.deepEqual(effective.maxCallSeconds, { value: 600, source: "avatar" });
    assert.equal(effective.instructions.usesRecommendedGuidance, true);
    assert.equal(typeof effective.render.creditsPerMinute, "number");
  });

  test("the call limit says when it comes from the install, not the avatar", async () => {
    const id = await newAvatar({});
    const { effective } = await config(id);
    assert.equal(effective.maxCallSeconds.source, "install default");
    assert.equal(effective.maxCallSeconds.value, env.maxCallSeconds);
  });

  test("temperature is reported as ignored when the model is not Claude", async () => {
    env.anthropicApiKey = "";
    const id = await newAvatar({ temperature: 1.3 });
    const c = await config(id);
    assert.equal(c.effective.llm.temperature.applied, false);
    assert.ok(codes(c).includes("temperature_ignored"));
  });

  test("and as applied when Claude is what runs", async () => {
    env.anthropicApiKey = "sk-test";
    const id = await newAvatar({ temperature: 1.3, llmModel: "claude-sonnet-5" });
    const c = await config(id);
    assert.equal(c.effective.llm.provider, "anthropic");
    assert.equal(c.effective.llm.temperature.applied, true);
    assert.ok(!codes(c).includes("temperature_ignored"));
  });

  test("a voice speed the voice model cannot apply is flagged", async () => {
    env.ttsModel = "acme/unknown-tts";
    const id = await newAvatar({ voiceSpeed: 0.8 });
    const c = await config(id);
    assert.equal(c.effective.voice.speed.applied, false);
    assert.ok(codes(c).includes("voice_speed_ignored"));
  });

  test("an ElevenLabs voice without a server key is shown as substituted, with both names", async () => {
    env.elevenlabs.apiKey = "";
    const id = await newAvatar({ voice: "elevenlabs:21m00Tcm4TlvDq8ikWAM" });
    const c = await config(id);

    assert.equal(c.effective.voice.configured, "elevenlabs:21m00Tcm4TlvDq8ikWAM");
    assert.equal(c.effective.voice.spoken, env.ttsVoice);
    assert.equal(c.effective.voice.substituted, true);
    const warning = c.warnings.find((w) => w.code === "voice_substituted");
    assert.match(warning.message, /21m00Tcm4TlvDq8ikWAM/);
    assert.equal(c.warnings.filter((w) => /ELEVENLABS_API_KEY/.test(w.message) && w.code === "degraded").length, 0, "not said twice");
  });

  test("with the key present the configured voice is the spoken one", async () => {
    env.elevenlabs.apiKey = "eleven-key";
    const id = await newAvatar({ voice: "elevenlabs:21m00Tcm4TlvDq8ikWAM" });
    const c = await config(id);
    assert.equal(c.effective.voice.spoken, "elevenlabs:21m00Tcm4TlvDq8ikWAM");
    assert.equal(c.effective.voice.substituted, false);
    assert.ok(!codes(c).includes("voice_substituted"));
  });

  test("a Russian greeting on an English avatar is warned about, not refused", async () => {
    const id = await newAvatar({ language: "en", greeting: "Здравствуйте! Чем могу вам помочь сегодня?" });
    const c = await config(id);
    const w = c.warnings.find((x) => x.code === "language_mismatch");
    assert.equal(w.field, "greeting");
    assert.match(w.message, /cyrillic/);
  });

  test("the same text is fine on a Russian avatar, and Hindi may be typed in Latin letters", async () => {
    const ru = await config(await newAvatar({ language: "ru", greeting: "Здравствуйте! Чем могу вам помочь сегодня?" }));
    assert.ok(!codes(ru).includes("language_mismatch"));
    const hi = await config(await newAvatar({ language: "hi", greeting: "Namaste! Main aapki kaise madad kar sakta hoon?" }));
    assert.ok(!codes(hi).includes("language_mismatch"));
  });

  test("is for the avatar's own workspace", async () => {
    const id = await newAvatar({});
    const other = await signUp(app.baseUrl);
    assert.equal((await other.get(`/api/avatars/${id}/config`)).status, 404);
  });
});

describe("dominantScript", () => {
  test("names the script most letters are in, and says nothing about short or mixed text", () => {
    assert.equal(dominantScript("Hello there, how are you today?"), "latin");
    assert.equal(dominantScript("Привет, как у вас дела сегодня?"), "cyrillic");
    assert.equal(dominantScript("नमस्ते आप कैसे हैं आज"), "devanagari");
    assert.equal(dominantScript("Hi"), null);
    assert.equal(dominantScript("Hello мирр hello мирр"), null);
  });
});

describe("the language setting reaches the model", () => {
  const avatar = (language, extra = {}) => ({
    name: "Marcus",
    persona: { systemPrompt: "You speak for a studio.", language, ...extra },
  });

  test("a call is told which language to speak, even when the greeting or documents are in another", () => {
    const text = instructionsFor({
      ...avatar("en", { greeting: "Здравствуйте! Вы связались со студией." }),
      documents: [{ name: "Fact sheet", text: "Мы создаём видео для брендов." }],
    });
    assert.match(text, /Speak English\./);
    assert.match(text, /first greeting as well/);
    // The language line comes before the reference material, so it is not drowned by it.
    assert.ok(text.indexOf("Speak English") < text.indexOf("Fact sheet"));
  });

  test("follows the setting, and says nothing for a language the app does not list", () => {
    assert.match(instructionsFor(avatar("hi")), /Speak Hindi\./);
    assert.doesNotMatch(instructionsFor(avatar("xx")), /Speak /);
  });
});
