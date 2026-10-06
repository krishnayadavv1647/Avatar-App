import { env } from "../../config/env.js";

/**
 * Kie.ai's Flux Kontext: one model that makes a picture from text and edits one
 * from text plus the picture.
 *
 *   POST /api/v1/flux/kontext/generate         -> { code, msg, data: { taskId } }
 *   GET  /api/v1/flux/kontext/record-info      -> { data: { successFlag, response, errorMessage } }
 *
 * Kie answers HTTP 200 for most failures and puts the real outcome in the
 * body's `code` (401 key, 402 credits, 422 refused, 429 busy), so both are read.
 * Failures are thrown as errors a person can read, with `statusCode` set the
 * way our own API should answer.
 */
export const MODELS = ["flux-kontext-pro", "flux-kontext-max"];
export const ASPECT_RATIOS = ["3:4", "9:16", "1:1"];

const fail = (statusCode, message, extra) => Object.assign(new Error(message), { statusCode, ...extra });

export const configured = () => Boolean(env.kie.apiKey);

/** The error to raise for a Kie reply that did not succeed. */
export function kieError(httpStatus, body) {
  const code = typeof body?.code === "number" && body.code !== 200 ? body.code : httpStatus;
  const detail = String(body?.msg || body?.message || "").trim();

  if (/PROHIBITED|content policy|sensitive|flagged/i.test(detail) || code === 422) {
    return fail(422, "The image service refused that. Try describing it differently.");
  }
  if (code === 401 || code === 403) {
    return fail(503, "Image generation is not working: the image service rejected its key. An admin can fix it in Admin -> API Keys.", {
      report: true,
    });
  }
  if (code === 402 || /insufficient|credit|quota/i.test(detail)) {
    return fail(503, "Image generation is out of credits. An admin needs to top up the Kie.ai account.", { report: true });
  }
  if (code === 429) return fail(429, "The image service is busy. Try again in a moment.");
  return fail(502, `The image service could not do that${detail ? `: ${detail}` : ""}.`, { report: true });
}

async function call(path, { method = "GET", body } = {}) {
  if (!configured()) {
    throw fail(503, "Image generation is not set up. An admin can add a Kie.ai key in Admin -> API Keys.");
  }
  let res;
  try {
    res = await fetch(`${env.kie.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.kie.apiKey}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw fail(502, "Could not reach the image service. Try again in a moment.", { report: true, cause: err });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || (json && typeof json.code === "number" && json.code !== 200)) throw kieError(res.status, json);
  return json;
}

/**
 * Starts a picture. With `inputImage` (a public https address) it edits that
 * picture; without, it makes one from the prompt alone.
 * @returns {Promise<string>} the vendor's task id
 */
export async function startImage({ prompt, inputImage, aspectRatio, model = "flux-kontext-pro" }) {
  const json = await call("/api/v1/flux/kontext/generate", {
    method: "POST",
    body: {
      prompt,
      model,
      outputFormat: "jpeg",
      enableTranslation: true,
      promptUpsampling: false,
      ...(inputImage ? { inputImage } : { aspectRatio }),
    },
  });
  const taskId = json?.data?.taskId;
  if (!taskId) throw fail(502, "The image service did not start the picture. Try again.", { report: true });
  return taskId;
}

/**
 * Where a task stands: `{ state: "pending" }`, `{ state: "success", url }` or
 * `{ state: "failed", error }`. successFlag: 0 working, 1 done, 2 and 3 failed.
 */
export async function imageStatus(taskId) {
  const json = await call(`/api/v1/flux/kontext/record-info?taskId=${encodeURIComponent(taskId)}`);
  const data = json?.data || {};

  if (data.successFlag === 1) {
    const url = data.response?.resultImageUrl;
    return url ? { state: "success", url } : { state: "failed", error: "The image service finished without a picture." };
  }
  if (data.successFlag === 2 || data.successFlag === 3) {
    const refused = /PROHIBITED|content policy|sensitive|flagged/i.test(data.errorMessage || "");
    return {
      state: "failed",
      error: refused
        ? "The image service refused that. Try describing it differently."
        : data.errorMessage || "The picture could not be made.",
    };
  }
  return { state: "pending" };
}
