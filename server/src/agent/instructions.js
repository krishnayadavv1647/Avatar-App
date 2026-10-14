import { RECOMMENDED_PROMPT } from "../ai/prompts/personality.js";
import { knowledgePrompt } from "../ai/knowledge.js";
import { LANGUAGES } from "../ai/catalog.js";

/**
 * What a call tells the language model about itself: the brief, who it is
 * talking to, and the reference documents.
 *
 * Lives apart from the worker so the text-only test (modules/avatars/
 * test.service.js) builds exactly the same instructions a real call would,
 * rather than a copy that can drift.
 *
 * @param {{ name: string, persona?: object, documents?: Array<{ name: string, text: string }> }} avatar
 * @param {{ guest?: { name?: string }, meetingUrl?: string }} [conversation]
 */
export function instructionsFor(avatar, conversation = {}) {
  const own =
    avatar.persona?.systemPrompt ||
    `You are ${avatar.name}, a friendly AI avatar speaking with someone over video. ` +
      `Keep replies to two or three sentences.`;
  // "Default personality" on the settings page: spoken-conversation guidance
  // added after the persona's own brief, never instead of it.
  const parts = [avatar.persona?.useDefaultPrompt ? `${own}\n\n${RECOMMENDED_PROMPT}` : own];

  // The language setting drives speech recognition and the voice; without this
  // line nothing told the model which language to answer in, so a greeting or
  // fact sheet in another language pulled the whole call into that language.
  const language = LANGUAGES.find((l) => l.code === avatar.persona?.language);
  if (language) {
    parts.push(
      `Speak ${language.label}. This applies to your first greeting as well, even if the instructions or reference ` +
        `material are written in another language. Only if the caller clearly speaks to you in another language, ` +
        `answer in theirs.`,
    );
  }
  // Someone arriving by share link typed their name before joining. An
  // interviewer that knows who it is talking to sounds like one.
  const guest = conversation.guest?.name;
  if (guest) parts.push(`The person on this call is called ${guest}. Use their name naturally.`);

  if (conversation.meetingUrl) {
    parts.push(
      "You have joined a video meeting as one of its participants. Several people may be " +
        "talking. Reply when someone speaks to you or asks a question, keep answers short, " +
        "and do not interrupt a conversation between others.",
    );
  }

  // How to use the call tools its owner switched on (agent/callTools.js).
  const toolGuidance = callToolGuidance(avatar.persona);
  if (toolGuidance) parts.push(toolGuidance);

  // The knowledge base goes last: reference material, after who the avatar is
  // and who it is talking to.
  const knowledge = knowledgePrompt(avatar.documents);
  if (knowledge) parts.push(knowledge);

  return parts.join("\n\n");
}

/** The sentences added to an avatar's instructions when these tools are on. */
export function callToolGuidance(persona) {
  const lines = [];
  if (persona?.captureLeads) {
    lines.push(
      "When a caller shows interest and is happy to share contact details, ask for their name and an email address " +
        "or phone number, then use save_lead. Never ask for or save anything they have not offered.",
    );
  }
  if (persona?.humanHandoff) {
    lines.push(
      "If the caller asks for a person, or you cannot answer, offer to have the team contact them: get an email or " +
        "phone number and a short reason, then use request_human. You cannot transfer the call live - say that someone " +
        "will get back to them rather than promising they will join now.",
    );
  }
  return lines.join("\n");
}