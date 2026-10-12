import { z } from "zod";
import { llm } from "@livekit/agents";
import { leadService } from "../modules/leads/lead.service.js";
import { logger } from "../config/logger.js";

/**
 * Tools an avatar can use on a call because its owner switched them on:
 *
 *   save_lead      store the caller's contact details as a lead
 *   request_human  record that the caller wants a person, and tell the owner
 *
 * Which workspace, avatar and conversation a tool writes to is fixed here from
 * the call itself. The model only supplies what the caller said; there is no
 * argument that could point a write somewhere else.
 *
 * Results are plain sentences: they go straight back to the model, and a
 * validation message ("ask for an email or a phone number") is the model's cue
 * to ask the caller, so none of them throws.
 *
 * @returns {Array} tools to hand the agent, empty when nothing is switched on
 */
export function buildCallTools({ avatar, conversation }) {
  const persona = avatar.persona || {};
  const scope = {
    workspaceId: conversation.workspaceId,
    avatarId: avatar._id,
    conversationId: conversation._id,
    guest: conversation.guest,
  };
  const tools = [];

  const guarded = (label, fn) => async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err.statusCode && err.statusCode < 500) return err.message;
      logger.error({ err: err.message, tool: label }, "call tool failed");
      return "That could not be saved right now. Tell the caller you will pass their details on another way, and carry on.";
    }
  };

  if (persona.captureLeads) {
    tools.push(
      llm.tool({
        name: "save_lead",
        description:
          "Save the caller's contact details so the team can follow up. Use it only after the caller has agreed to " +
          "share them. You need an email address or a phone number; ask for what is missing before calling. " +
          "Call it again if they correct or add something.",
        parameters: z.object({
          name: z.string().optional().describe("The caller's name"),
          email: z.string().optional().describe("The caller's email address, exactly as they gave it"),
          phone: z.string().optional().describe("The caller's phone number, with country code if they gave one"),
          requirement: z.string().optional().describe("What they are looking for, in one or two sentences"),
        }),
        execute: guarded("save_lead", async (args) => {
          const { created } = await leadService.capture(scope, args);
          return created
            ? "Saved. Tell the caller their details have been passed to the team."
            : "Updated. Tell the caller their details are noted.";
        }),
      }),
    );
  }

  if (persona.humanHandoff) {
    tools.push(
      llm.tool({
        name: "request_human",
        description:
          "Use when the caller asks to speak to a person, or when you cannot help them. Records the request and tells " +
          "the team. Get the caller's contact (email or phone) and a short reason first. This does not connect a live " +
          "call: tell the caller someone will get back to them.",
        parameters: z.object({
          name: z.string().optional().describe("The caller's name"),
          contact: z.string().describe("Email address or phone number the team can reach them on"),
          reason: z.string().describe("What they need, in a sentence"),
          preferredTime: z.string().optional().describe("When they would like to be contacted, if they said"),
        }),
        execute: guarded("request_human", async (args) => {
          await leadService.requestHuman(scope, args);
          return "Recorded and the team has been told. Tell the caller someone will contact them, and that this is not a live transfer.";
        }),
      }),
    );
  }

  return tools;
}
