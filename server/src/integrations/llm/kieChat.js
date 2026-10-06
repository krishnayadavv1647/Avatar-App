import { env } from "../../config/env.js";
import { configured, kieError } from "../imagegen/kie.js";

/**
 * ChatGPT through Kie.ai, for one-shot writing jobs on the server (not for
 * calls - the call's own model is set per avatar in the agent worker).
 *
 *   POST {base}/gpt-5-2/v1/chat/completions  -> OpenAI-style { choices[0].message.content }
 *
 * Kie answers HTTP 200 for some failures and puts the outcome in the body's
 * `code`, so both are read, exactly as for pictures (imagegen/kie.js).
 */
const MODEL_PATH = "/gpt-5-2/v1/chat/completions";
const TIMEOUT_MS = 75_000;

export const chatConfigured = configured;

const fail = (statusCode, message, extra) => Object.assign(new Error(message), { statusCode, ...extra });

/**
 * @param {{ system: string, user: string, effort?: "low" | "high" }} input
 * @returns {Promise<string>} the model's reply text
 */
export async function chat({ system, user, effort = "low" }) {
  if (!configured()) {
    throw fail(503, "The AI service is not set up. An admin can add a Kie.ai key in Admin -> API Keys.");
  }

  let res;
  try {
    res = await fetch(`${env.kie.baseUrl}${MODEL_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.kie.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: [{ type: "text", text: system }] },
          { role: "user", content: [{ type: "text", text: user }] },
        ],
        reasoning_effort: effort,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw fail(502, "Could not reach the AI service. Try again in a moment.", { report: true, cause: err });
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || (json && typeof json.code === "number" && json.code !== 200)) throw kieError(res.status, json);

  const content = json?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((part) => part?.text || "").join("") : content;
  if (!text || !String(text).trim()) throw fail(502, "The AI service returned nothing. Try again.", { report: true });
  return String(text).trim();
}
