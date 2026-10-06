import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { avatarService } from "../avatars/avatar.service.js";
import { studioService } from "../studio/studio.service.js";
import { behaviourFields, gender } from "../studio/studio.validation.js";
import { FACES, FACE_LIBRARY } from "../../avatar/faceLibrary.js";
import { LANGUAGES, llmModels, voicesForTts } from "../../ai/catalog.js";
import { assertSafeUrl } from "../../integrations/mcp/index.js";
import { knowledgeService } from "../avatars/knowledge.service.js";
import { websiteService } from "../avatars/website.service.js";
import { voiceService } from "../voices/voice.service.js";
import { imageGenService } from "../studio/imagegen.service.js";
import { env } from "../../config/env.js";

/**
 * The app's own MCP server: lets Claude, ChatGPT, Cursor and other MCP clients
 * manage avatars on behalf of the person whose key they hold.
 *
 * Tools call the same services the web app's routes do, so plan limits,
 * workspace scoping and validation apply unchanged. Nothing here reaches
 * another workspace: every call is bound to the key's workspace.
 */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_SAMPLE_BYTES = 20 * 1024 * 1024;
const EXTENSION_BY_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Not a valid avatar id");
const shareUrl = (token) => `${env.clientOrigin.replace(/\/$/, "")}/talk/${token}`;

/** The fields an assistant needs; the raw document carries a lot of internals. */
const slim = (a) => ({
  id: String(a._id),
  name: a.name,
  gender: a.gender || null,
  status: a.status,
  callable: a.callable,
  provider: a.providerId,
  previewUrl: a.previewUrl || null,
  persona: a.personaId
    ? {
        systemPrompt: a.personaId.systemPrompt,
        greeting: a.personaId.greeting,
        language: a.personaId.language,
        voice: a.personaId.voice,
        llmModel: a.personaId.llmModel,
      }
    : null,
  shareLink: a.share?.enabled ? shareUrl(a.share.token) : null,
});

/** What someone needs to put an avatar on another site: its id, public link and both embed snippets. */
const deployment = (avatarId, share) => {
  const origin = env.clientOrigin.replace(/\/$/, "");
  const on = Boolean(share?.enabled && share.token);
  return {
    avatarId: String(avatarId),
    agentId: String(avatarId),
    shareEnabled: on,
    shareLink: on ? shareUrl(share.token) : null,
    embed: on
      ? {
          widgetScript: `<script src="${origin}/embed.js" data-token="${share.token}" async></script>`,
          iframe: `<iframe src="${origin}/embed/${share.token}" title="Avatar" width="400" height="640" allow="microphone; camera; autoplay" style="border:0;border-radius:16px;max-width:100%"></iframe>`,
        }
      : null,
  };
};

/** A workspace voice as an assistant needs it: the `id` goes in persona.voice. */
const ownVoice = (v) => ({
  id: v.providerVoiceId,
  name: v.name,
  provider: v.provider,
  gender: v.gender || null,
  language: v.language || null,
});

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

/** A thrown error the client should read, not a crash. */
const failure = (err) => ({
  isError: true,
  content: [{ type: "text", text: err.statusCode && err.statusCode < 500 ? err.message : "Something went wrong" }],
});

const run = (fn) => async (args) => {
  try {
    return json(await fn(args));
  } catch (err) {
    return failure(err);
  }
};

/** Downloads a photo from a public URL, refusing private addresses and big files. */
async function fetchPhoto(raw) {
  await assertSafeUrl(raw);
  // Redirects are refused: the check above covers only the address we were given.
  const res = await fetch(raw, { redirect: "error", signal: AbortSignal.timeout(15_000) }).catch(() => {
    throw Object.assign(new Error("Could not download the photo"), { statusCode: 422 });
  });
  if (!res.ok) throw Object.assign(new Error(`The photo URL answered ${res.status}`), { statusCode: 422 });

  const mimetype = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_PHOTO_BYTES) throw Object.assign(new Error("The photo is over 10 MB"), { statusCode: 422 });

  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    buffer,
    mimetype,
    size: buffer.length,
    originalname: `photo.${EXTENSION_BY_TYPE[mimetype] || "jpg"}`,
  };
}

/** Downloads a voice sample from a public URL, with the same address checks as a photo. */
async function fetchSample(raw) {
  await assertSafeUrl(raw);
  const res = await fetch(raw, { redirect: "error", signal: AbortSignal.timeout(30_000) }).catch(() => {
    throw Object.assign(new Error("Could not download the voice sample"), { statusCode: 422 });
  });
  if (!res.ok) throw Object.assign(new Error(`The sample URL answered ${res.status}`), { statusCode: 422 });
  const mimetype = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (Number(res.headers.get("content-length")) > MAX_SAMPLE_BYTES) {
    throw Object.assign(new Error("The voice sample is over 20 MB"), { statusCode: 422 });
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_SAMPLE_BYTES) throw Object.assign(new Error("The voice sample is over 20 MB"), { statusCode: 422 });
  return { buffer, mimetype, size: buffer.length, originalname: new URL(raw).pathname.split("/").pop() || "sample" };
}

/** Makes a face from a description with the image service and waits for it (about half a minute). */
async function generateFace({ workspace, userId, prompt }) {
  const framing =
    ", photorealistic portrait photograph, head and shoulders, face centred and facing the camera, " +
    "mouth closed with a soft natural expression, soft studio lighting, sharp focus, no text, no watermark";
  const { taskId } = await imageGenService.generate({ workspace, userId, prompt: prompt + framing, aspectRatio: "3:4" });
  const until = Date.now() + 120_000;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.MCP_FACE_POLL_MS) || 3000));
    const state = await imageGenService.status(userId, taskId);
    if (state.status === "failed") throw Object.assign(new Error(state.error || "The face could not be made"), { statusCode: 422 });
    if (state.status === "success") break;
    if (Date.now() > until) throw Object.assign(new Error("The face took too long. Try again."), { statusCode: 504 });
  }
  const { buffer, type } = await imageGenService.file(userId, taskId);
  return { buffer, mimetype: type, size: buffer.length, originalname: "face.jpg" };
}

/** One server per request: the key's workspace is fixed at construction. */
export function createAvatarMcpServer({ workspace, userId }) {
  const server = new McpServer({ name: "avatar-studio", version: "1.0.0" });
  const ws = workspace._id;

  server.registerTool(
    "list_avatars",
    { description: "List the avatars in the workspace.", annotations: { readOnlyHint: true } },
    run(async () => (await avatarService.list(ws)).map(slim)),
  );

  server.registerTool(
    "get_avatar",
    {
      description: "Get one avatar's details, including its persona (prompt, greeting, voice, model).",
      inputSchema: { avatarId: objectId },
      annotations: { readOnlyHint: true },
    },
    run(async ({ avatarId }) => slim(await avatarService.get(ws, avatarId))),
  );

  server.registerTool(
    "list_options",
    {
      description:
        "What an avatar can be configured with: library faces (use their id as faceId in create_avatar), " +
        "voices (built-in, plus the workspace's own cloned/ElevenLabs voices - use a voice's `id` as persona.voice), " +
        "language models and languages.",
      annotations: { readOnlyHint: true },
    },
    run(async () => ({
      faces: FACES.map((f) => ({ faceId: f.id, name: f.name, gender: f.gender })),
      voices: voicesForTts().map((v) => v.id),
      ownVoices: (await voiceService.list(workspace)).map(ownVoice),
      llmModels: llmModels().map((m) => ({ id: m.id, label: m.label, available: m.available })),
      languages: LANGUAGES,
    })),
  );

  server.registerTool(
    "list_voices",
    {
      description:
        "Every voice an avatar can use: the built-in ones and the workspace's own (cloned or ElevenLabs). " +
        "Pass a voice's `id` as persona.voice in create_avatar or update_avatar.",
      annotations: { readOnlyHint: true },
    },
    run(async () => ({
      builtIn: voicesForTts().map((v) => ({ id: v.id, gender: v.gender, description: v.description })),
      own: (await voiceService.list(workspace)).map(ownVoice),
    })),
  );

  server.registerTool(
    "add_voice",
    {
      description:
        "Add a voice to the workspace so avatars can use it. Give exactly one of: elevenLabsVoiceId (a voice already in " +
        "the connected ElevenLabs account - this is how to reuse a voice made elsewhere, e.g. for another project, as long " +
        "as it is in that account), sampleUrl (a public https link to a clean recording of the voice, which is cloned " +
        "through ElevenLabs), or liveKitVoiceId (a v_* id cloned in LiveKit Cloud). Returns the voice with its `id`.",
      inputSchema: {
        name: z.string().trim().min(1).max(60).optional(),
        elevenLabsVoiceId: z.string().trim().min(5).max(80).optional(),
        sampleUrl: z.string().url().optional(),
        liveKitVoiceId: z.string().trim().min(3).max(80).optional(),
        gender: gender.optional(),
        language: z.string().trim().min(2).max(10).optional(),
      },
    },
    run(async ({ name, elevenLabsVoiceId, sampleUrl, liveKitVoiceId, gender: g, language }) => {
      const given = [elevenLabsVoiceId, sampleUrl, liveKitVoiceId].filter(Boolean).length;
      if (given !== 1) {
        throw Object.assign(new Error("Provide exactly one of elevenLabsVoiceId, sampleUrl or liveKitVoiceId"), { statusCode: 422 });
      }
      if (!elevenLabsVoiceId && !name) throw Object.assign(new Error("Give the voice a name"), { statusCode: 422 });
      const base = { workspace, name, gender: g, language };
      const voice = elevenLabsVoiceId
        ? await voiceService.importElevenLabs({ ...base, voiceId: elevenLabsVoiceId })
        : sampleUrl
          ? await voiceService.clone({ ...base, file: await fetchSample(sampleUrl) })
          : await voiceService.create({ ...base, voiceId: liveKitVoiceId });
      return ownVoice(voice);
    }),
  );

  server.registerTool(
    "create_avatar",
    {
      description:
        "Create an avatar, optionally finished and ready to deploy in one call. Face: exactly one of faceId (a library " +
        "face from list_options), photoUrl (a public https link to a portrait photo, JPEG/PNG/WebP up to 10 MB) or " +
        "facePrompt (describe the person and one is generated, takes about half a minute). Use persona to set how it " +
        "talks (systemPrompt, greeting, voice from list_voices, language, llmModel). Give websiteUrl to have it read that " +
        "website and learn the business (fact sheet in its knowledge, and - unless you gave your own persona.systemPrompt - " +
        "its instructions and greeting). Set publish to turn on the public link and get the embed code.",
      inputSchema: {
        name: z.string().trim().min(1).max(80),
        faceId: z.string().regex(/^face_[fm]\d{2}$/).optional(),
        photoUrl: z.string().url().optional(),
        facePrompt: z.string().trim().min(10).max(600).optional(),
        gender: gender.optional(),
        persona: behaviourFields.optional().describe("systemPrompt, greeting, language, voice, llmModel, ..."),
        websiteUrl: z.string().trim().min(3).max(2000).optional(),
        publish: z.boolean().optional(),
      },
    },
    run(async ({ name, faceId, photoUrl, facePrompt, gender: g, persona, websiteUrl, publish }) => {
      if ([faceId, photoUrl, facePrompt].filter(Boolean).length !== 1) {
        throw Object.assign(new Error("Provide exactly one of faceId, photoUrl or facePrompt"), { statusCode: 422 });
      }
      const common = { workspace, name, gender: g, behaviour: persona, userId };
      const created = faceId
        ? await studioService.createFromStock({
            ...common,
            providerId: FACE_LIBRARY,
            providerAvatarId: faceId,
          })
        : await studioService.createFromPhoto({
            ...common,
            file: photoUrl ? await fetchPhoto(photoUrl) : await generateFace({ workspace, userId, prompt: facePrompt }),
          });

      const result = {};
      if (websiteUrl) {
        try {
          const learned = await websiteService.learn(
            ws,
            created._id,
            { url: websiteUrl, applyBrief: !persona?.systemPrompt },
            userId,
          );
          result.learned = { document: learned.document.name, pages: learned.pages, briefWritten: Boolean(learned.brief) };
        } catch (err) {
          // The avatar exists either way; say what did not work so it can be retried.
          result.learnError = err.statusCode && err.statusCode < 500 ? err.message : "Could not learn the website";
        }
      }
      if (publish) result.deployment = deployment(created._id, await avatarService.setShare(ws, created._id, { enabled: true }));

      return { ...slim(await avatarService.get(ws, created._id)), ...result };
    }),
  );

  server.registerTool(
    "update_avatar",
    {
      description:
        "Change an existing avatar: name, gender, persona (systemPrompt, greeting, voice, language, llmModel, ...) and " +
        "render settings (aspectRatio 2x3 | 9x16 | 1x1, model standard | flash | lite). Only the fields you pass change; " +
        "the avatar keeps its id, link and knowledge.",
      inputSchema: {
        avatarId: objectId,
        name: z.string().trim().min(1).max(80).optional(),
        gender: gender.optional(),
        persona: behaviourFields.optional(),
        render: z
          .object({
            aspectRatio: z.enum(["2x3", "9x16", "1x1"]).optional(),
            model: z.enum(["standard", "flash", "lite"]).optional(),
          })
          .optional(),
      },
    },
    run(async ({ avatarId, name, gender: g, persona, render }) =>
      slim(await avatarService.update(ws, avatarId, { name, gender: g, persona, render })),
    ),
  );

  server.registerTool(
    "list_knowledge",
    {
      description: "List the documents in an avatar's knowledge base (name, size, when added; not the text).",
      inputSchema: { avatarId: objectId },
      annotations: { readOnlyHint: true },
    },
    run(async ({ avatarId }) => knowledgeService.list(ws, avatarId)),
  );

  server.registerTool(
    "save_knowledge",
    {
      description:
        "Teach an avatar something by text (price lists, FAQs, policies, a customer's data). A document with the same " +
        "name is replaced, so call this again with the same name when the information changes - no need to recreate " +
        "the avatar. Up to 100,000 characters per document, 10 documents per avatar.",
      inputSchema: {
        avatarId: objectId,
        name: z.string().trim().min(1).max(120),
        content: z.string().min(1).max(400_000),
      },
    },
    run(async ({ avatarId, name, content }) => knowledgeService.saveText(ws, avatarId, { name, content }, userId)),
  );

  server.registerTool(
    "train_from_website",
    {
      description:
        "Have an avatar read a website and learn the business: it reads the page plus a few related pages (about, " +
        "services, pricing, contact), writes a fact sheet into the avatar's knowledge, and (applyBrief, default true) " +
        "rewrites its instructions and greeting from the site. Calling it again for the same site refreshes the " +
        "knowledge, so use it to re-sync when the website changes. Takes up to a minute.",
      inputSchema: {
        avatarId: objectId,
        url: z.string().trim().min(3).max(2000),
        applyBrief: z.boolean().optional(),
      },
    },
    run(async ({ avatarId, url, applyBrief }) => {
      const learned = await websiteService.learn(ws, avatarId, { url, applyBrief: applyBrief ?? true }, userId);
      return { document: learned.document, pages: learned.pages, briefWritten: Boolean(learned.brief), brief: learned.brief || null };
    }),
  );

  server.registerTool(
    "remove_knowledge",
    {
      description: "Remove one document from an avatar's knowledge base (ids from list_knowledge).",
      inputSchema: { avatarId: objectId, documentId: objectId },
      annotations: { destructiveHint: true },
    },
    run(async ({ avatarId, documentId }) => knowledgeService.remove(ws, avatarId, documentId)),
  );

  server.registerTool(
    "get_deployment",
    {
      description:
        "Everything needed to put an avatar on another site: its id (agentId), public talk link and the embed code " +
        "(a one-line widget script and an iframe). Turns the public link on if it is off, unless enable is false.",
      inputSchema: { avatarId: objectId, enable: z.boolean().optional() },
    },
    run(async ({ avatarId, enable }) => {
      const share =
        enable === false
          ? await avatarService.getShare(ws, avatarId)
          : await avatarService.setShare(ws, avatarId, { enabled: true });
      return deployment(avatarId, share);
    }),
  );

  server.registerTool(
    "set_share_link",
    {
      description:
        "Turn an avatar's public talk link on or off. Anyone with the link can talk to the avatar " +
        "(calls are billed to the workspace). Returns the link when on.",
      inputSchema: { avatarId: objectId, enabled: z.boolean() },
    },
    run(async ({ avatarId, enabled }) => {
      const share = await avatarService.setShare(ws, avatarId, { enabled });
      return { enabled: share.enabled, link: share.enabled ? shareUrl(share.token) : null, ...deployment(avatarId, share) };
    }),
  );

  server.registerTool(
    "delete_avatar",
    {
      description:
        "Permanently delete an avatar and its knowledge base. Cannot be undone - confirm with the user first.",
      inputSchema: { avatarId: objectId },
      annotations: { destructiveHint: true },
    },
    run(async ({ avatarId }) => {
      await avatarService.remove(ws, avatarId);
      return { deleted: avatarId };
    }),
  );

  return server;
}
