import crypto from "node:crypto";
import { ImageTask } from "../../models/index.js";
import { getStorage } from "../../integrations/storage/registry.js";
import { configured, imageStatus, startImage } from "../../integrations/imagegen/kie.js";
import { errorDetails, logError } from "../../utils/errorLog.js";
import { logger } from "../../config/logger.js";
import { isProd } from "../../config/env.js";

/**
 * "Generate image" and "Edit image" in the avatar creator, made by Kie.ai.
 *
 * Asynchronous end to end: a request starts the picture and returns a task id,
 * the page polls `status`, and when it is done fetches the bytes through `file`
 * - from this API, not from the vendor's address, so the browser never needs
 * the vendor's CORS permission to turn the picture into an uploaded photo.
 *
 * Every task belongs to the person who started it; no one else can poll it or
 * fetch its picture.
 */
const MAX_PENDING_PER_USER = 3;
const TASK_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RESULT_BYTES = 15 * 1024 * 1024;

export const EDIT_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
export const MAX_EDIT_BYTES = 10 * 1024 * 1024;

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** Server errors the vendor causes are worth an admin's attention; the person only sees the message. */
function report(err, where, userId) {
  if (err.report) {
    logError({
      errorType: "IMAGE_GENERATION",
      message: err.message,
      functionName: where,
      details: errorDetails(err, { userId: String(userId) }),
    });
  }
  return err;
}

async function startedByUser(userId, id) {
  const task = /^[0-9a-f]{24}$/i.test(id) ? await ImageTask.findOne({ _id: id, userId }) : null;
  if (!task) throw fail(404, "That picture was not found.");
  return task;
}

/** Removes the parked source picture of an edit, once the vendor no longer needs it. */
async function releaseInput(task) {
  if (!task.inputKey) return;
  await getStorage()
    .remove(task.inputKey)
    .catch((err) => logger.warn({ err: err.message }, "could not remove a parked edit source"));
  task.inputKey = undefined;
}

async function assertRoom(userId) {
  const since = new Date(Date.now() - TASK_TIMEOUT_MS);
  const pending = await ImageTask.countDocuments({ userId, status: "pending", createdAt: { $gt: since } });
  if (pending >= MAX_PENDING_PER_USER) {
    throw fail(429, "You already have pictures being made. Wait for them to finish.");
  }
}

export const imageGenService = {
  /** What the creator can offer right now, so it says so before anyone types a prompt. */
  availability() {
    const generate = configured();
    // The vendor fetches the source picture itself, so it must be reachable from outside.
    return { generate, edit: generate && getStorage().reachableByVendors };
  },

  async generate({ workspace, userId, prompt, aspectRatio, model }) {
    await assertRoom(userId);
    try {
      const providerTaskId = await startImage({ prompt, aspectRatio, model });
      const task = await ImageTask.create({
        workspaceId: workspace._id,
        userId,
        kind: "generate",
        prompt,
        aspectRatio,
        model,
        providerTaskId,
      });
      return { taskId: String(task._id) };
    } catch (err) {
      throw report(err, "imageGen.generate", userId);
    }
  },

  async edit({ workspace, userId, file, prompt }) {
    if (!file) throw fail(422, "Choose a picture to edit.");
    if (!EDIT_TYPES.has(file.mimetype)) throw fail(422, "That picture type is not supported. Use JPG, PNG or WebP.");
    if (file.size > MAX_EDIT_BYTES) throw fail(422, "That picture is over 10 MB.");
    if (!this.availability().generate) {
      throw fail(503, "Image generation is not set up. An admin can add a Kie.ai key in Admin -> API Keys.");
    }
    const storage = getStorage();
    if (!storage.reachableByVendors) {
      throw fail(503, "Editing needs public image storage, which this server does not have set up.");
    }
    await assertRoom(userId);

    // Parked where the vendor can fetch it, for as long as the edit takes.
    const stored = await storage.put({
      buffer: file.buffer,
      key: `${workspace._id}/imagegen/${crypto.randomUUID()}.${EDIT_TYPES.get(file.mimetype)}`,
      contentType: file.mimetype,
    });

    try {
      const providerTaskId = await startImage({ prompt, inputImage: stored.publicUrl });
      const task = await ImageTask.create({
        workspaceId: workspace._id,
        userId,
        kind: "edit",
        prompt,
        providerTaskId,
        inputKey: stored.storageKey,
      });
      return { taskId: String(task._id) };
    } catch (err) {
      await storage.remove(stored.storageKey).catch(() => {});
      throw report(err, "imageGen.edit", userId);
    }
  },

  /** `{ status: "pending" | "success" | "failed", error? }` - asks the vendor while it is pending. */
  async status(userId, id) {
    const task = await startedByUser(userId, id);

    if (task.status === "pending") {
      if (Date.now() - task.createdAt.getTime() > TASK_TIMEOUT_MS) {
        task.status = "failed";
        task.error = "The picture took too long. Try again.";
      } else {
        let result;
        try {
          result = await imageStatus(task.providerTaskId);
        } catch (err) {
          // A hiccup asking the vendor is not the picture failing; keep waiting.
          // Only a problem with our setup (key, credits) is worth stopping for.
          if (err.statusCode === 503) throw report(err, "imageGen.status", userId);
          result = { state: "pending" };
        }
        if (result.state === "success") {
          task.status = "success";
          task.resultUrl = result.url;
        } else if (result.state === "failed") {
          task.status = "failed";
          task.error = result.error;
        }
      }
      if (task.status !== "pending") await releaseInput(task);
      await task.save();
    }

    return { status: task.status, ...(task.status === "failed" && { error: task.error }) };
  },

  /** The finished picture's bytes. */
  async file(userId, id) {
    const task = await startedByUser(userId, id);
    if (task.status !== "success" || !task.resultUrl) throw fail(409, "That picture is not ready.");

    let url;
    try {
      url = new URL(task.resultUrl);
    } catch {
      throw fail(502, "The image service returned a bad address.");
    }
    // https only in production; a stand-in image service on this machine is plain http.
    if (url.protocol !== "https:" && !(url.protocol === "http:" && !isProd)) {
      throw fail(502, "The image service returned an unsafe address.");
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" }).catch(() => null);
    if (!res?.ok) throw fail(502, "Could not fetch the finished picture. Try again.");
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!type.startsWith("image/")) throw fail(502, "The image service returned something that is not a picture.");

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_RESULT_BYTES) throw fail(502, "The finished picture is too large.");
    return { buffer, type };
  },
};
