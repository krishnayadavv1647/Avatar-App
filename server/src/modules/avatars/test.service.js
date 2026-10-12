import { KnowledgeDocument } from "../../models/index.js";
import { env } from "../../config/env.js";
import { avatarService } from "./avatar.service.js";
import { instructionsFor } from "../../agent/instructions.js";
import { budgetReport, CONTEXT_BUDGET_CHARS } from "../../ai/knowledge.js";
import { isHostedModel } from "../../ai/catalog.js";
import { chat, chatConfigured } from "../../integrations/llm/kieChat.js";

/**
 * "Try it before you share it": ask an avatar something in text and get the
 * answer it would give, with no room, no voice, no video and no call credits.
 *
 * What is the same as a call: the instructions (built by the very function the
 * worker uses - agent/instructions.js), the knowledge documents and the model
 * settings. What is not: the speech stack, and - when the avatar runs on a
 * hosted model that only LiveKit Inference can reach - the model itself, for
 * which the AI service stands in. The reply says which, in `model.exact`, so a
 * text answer is never mistaken for a guarantee about the spoken one.
 */
const MAX_HISTORY = 12;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** The model this avatar would really use, and whether this server can run it. */
function plan(persona) {
  const wanted = persona?.llmModel || (env.anthropicApiKey ? env.defaultLlmModel : null);
  if (wanted && !isHostedModel(wanted) && env.anthropicApiKey) return { intended: wanted, runner: "anthropic", exact: true };
  return { intended: wanted || env.fallbackLlmModel, runner: "kie", exact: false };
}

async function askClaude({ model, system, history, message, temperature }) {
  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": env.anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system,
        ...(temperature != null && { temperature }),
        messages: [
          ...history.map((t) => ({ role: t.role, content: t.text })),
          { role: "user", content: message },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw fail(502, "Could not reach the language model. Try again in a moment.");
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw fail(503, "The language model rejected the server's key.");
  if (res.status === 429) throw fail(429, "The language model is busy. Try again in a moment.");
  if (!res.ok) throw fail(502, "The language model could not answer.");
  const text = (body?.content || []).map((part) => part?.text || "").join("").trim();
  if (!text) throw fail(502, "The language model returned nothing.");
  return text;
}

export const testService = {
  /**
   * @param {{ message: string, history?: Array<{ role: "user" | "assistant", text: string }> }} input
   */
  async reply(workspaceId, avatarId, { message, history = [] }) {
    const avatar = await avatarService.get(workspaceId, avatarId);
    const persona = avatar.personaId || {};
    const documents = await KnowledgeDocument.find({ avatarId }).sort({ createdAt: 1 }).select("name text chars").lean();

    const system = instructionsFor({ ...avatar, persona, documents }, {});
    const turns = history.slice(-MAX_HISTORY);
    const { intended, runner, exact } = plan(persona);

    let text;
    if (runner === "anthropic") {
      text = await askClaude({ model: intended, system, history: turns, message, temperature: persona.temperature });
    } else {
      if (!chatConfigured()) {
        throw fail(503, "Testing needs the AI service (Kie.ai) or an Anthropic key on the server. An admin can add one in Admin -> API Keys.");
      }
      const transcript = turns.map((t) => `${t.role === "user" ? "Caller" : "You"}: ${t.text}`).join("\n");
      text = await chat({
        system,
        user: `${transcript ? `Conversation so far:\n${transcript}\n\n` : ""}The caller says: ${message}\n\nReply as you would on the call.`,
      });
    }

    return {
      reply: text,
      model: {
        intended,
        used: runner === "anthropic" ? intended : "gpt-5-2 (stand-in)",
        exact,
        note: exact
          ? null
          : `${intended} runs inside the live call only; this answer uses a stand-in model with the same instructions and knowledge, so wording may differ.`,
      },
      knowledge: {
        budgetChars: CONTEXT_BUDGET_CHARS,
        documents: budgetReport(documents),
      },
      instructionsChars: system.length,
    };
  },
};
