import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { avatarService } from "../avatars/avatar.service.js";
import { studioService } from "../studio/studio.service.js";
import { behaviourFields, gender } from "../studio/studio.validation.js";
import { FACES, FACE_LIBRARY } from "../../avatar/faceLibrary.js";
import { LANGUAGES, llmModels, voicesForTts } from "../../ai/catalog.js";
import { assertSafeUrl } from "../../integrations/mcp/index.js";
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
        "voices, language models and languages.",
      annotations: { readOnlyHint: true },
    },
    run(async () => ({
      faces: FACES.map((f) => ({ faceId: f.id, name: f.name, gender: f.gender })),
      voices: voicesForTts().map((v) => v.id),
      llmModels: llmModels().map((m) => ({ id: m.id, label: m.label, available: m.available })),
      languages: LANGUAGES,
    })),
  );

  server.registerTool(
    "create_avatar",
    {
      description:
        "Create an avatar. Give it a face with exactly one of: faceId (a library face from list_options) " +
        "or photoUrl (a public https link to a portrait photo, JPEG/PNG/WebP up to 10 MB). " +
        "Use persona to set how it talks.",
      inputSchema: {
        name: z.string().trim().min(1).max(80),
        faceId: z.string().regex(/^face_[fm]\d{2}$/).optional(),
        photoUrl: z.string().url().optional(),
        gender: gender.optional(),
        persona: behaviourFields.optional().describe("systemPrompt, greeting, language, voice, llmModel, ..."),
      },
    },
    run(async ({ name, faceId, photoUrl, gender: g, persona }) => {
      if (Boolean(faceId) === Boolean(photoUrl)) {
        throw Object.assign(new Error("Provide exactly one of faceId or photoUrl"), { statusCode: 422 });
      }
      const common = { workspace, name, gender: g, behaviour: persona, userId };
      const created = faceId
        ? await studioService.createFromStock({
            ...common,
            providerId: FACE_LIBRARY,
            providerAvatarId: faceId,
          })
        : await studioService.createFromPhoto({ ...common, file: await fetchPhoto(photoUrl) });
      return slim(await avatarService.get(ws, created._id));
    }),
  );

  server.registerTool(
    "update_avatar",
    {
      description: "Change an avatar's name, gender or persona. Only the fields you pass are changed.",
      inputSchema: {
        avatarId: objectId,
        name: z.string().trim().min(1).max(80).optional(),
        gender: gender.optional(),
        persona: behaviourFields.optional(),
      },
    },
    run(async ({ avatarId, name, gender: g, persona }) =>
      slim(await avatarService.update(ws, avatarId, { name, gender: g, persona })),
    ),
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
      return { enabled: share.enabled, link: share.enabled ? shareUrl(share.token) : null };
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
