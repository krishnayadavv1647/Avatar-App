import { fileURLToPath } from "node:url";
import { ServerOptions, cli, defineAgent, voice } from "@livekit/agents";
import mongoose from "mongoose";
import { connectDb } from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { endRoom, livekitConfig } from "../integrations/livekit/index.js";
import { Avatar, Conversation } from "../models/index.js";
import { roomService } from "../modules/rooms/room.service.js";
import { getRenderer } from "./renderers/registry.js";
import { buildPipelineConfig, logPipelineMode } from "./pipeline.js";
import { createTranscriptRecorder } from "./transcript.recorder.js";
import { RECOMMENDED_PROMPT } from "../ai/prompts/personality.js";
import { knowledgePrompt } from "../ai/knowledge.js";
import { knowledgeService } from "../modules/avatars/knowledge.service.js";
import { mcpService } from "../modules/avatars/mcp.service.js";
import { connectMcpTools } from "../integrations/mcp/index.js";
import { errorDetails, logError } from "../utils/errorLog.js";
import { applyApiConfigs } from "../modules/admin/system/apiConfig.service.js";
import { preflight } from "./preflight.js";
import { waitForCallReady } from "./callReady.js";
import { isPreviewRoom, runPreview } from "./preview.job.js";

// How long LemonSlice keeps the face up with nothing to say, in a meeting.
// The default (a minute) suits a one-to-one call, not a meeting that talks
// among itself for a while.
const MEETING_IDLE_SECONDS = 600;

/**
 * The realtime worker. One long-lived process, separate from the API, that
 * receives job dispatches from LiveKit and drives a call for its lifetime.
 *
 * It reads the database directly because it needs the avatar's provider,
 * persona and voice for each job - which is why it lives inside server/ and
 * shares models rather than being its own package.
 *
 * Only render-only providers get here. Full-pipeline vendors run the
 * conversation on their own infrastructure and never dispatch to us.
 */
export default defineAgent({
  entry: async (ctx) => {
    if (mongoose.connection.readyState === 0) await connectDb();
    // A job runs in its own process, so keys saved in the admin panel reach it only here.
    await applyApiConfigs().catch((err) => logger.warn({ err: err.message }, "could not apply saved API keys"));

    await ctx.connect();

    // A preview room records the avatar's hover clip; it is not a call.
    if (isPreviewRoom(ctx.room.name)) {
      await runPreview(ctx);
      return;
    }

    const { conversation, avatar } = await resolveJob(ctx);

    // Settings that would break the call are caught before a vendor session is
    // opened, and end it with the reason rather than leaving the caller on
    // "Connecting..." - see agent/preflight.js.
    const check = await preflight(avatar);
    for (const warning of check.warnings) logger.warn({ room: ctx.room.name }, warning);
    if (check.errors.length) {
      await abandon(ctx, conversation, `could not start: ${check.errors.join(" ")}`);
      return;
    }

    const renderer = getRenderer(avatar.providerId);
    const pipeline = buildPipelineConfig(avatar);
    logPipelineMode(pipeline);

    let session = null;
    let transcript = null;
    let mcp = null;
    let endReason = "room closed";
    let failed = false;

    // The persona's limit, or the install's. The brief promises "calls end
    // automatically after this", and on a public link it is also the only cap
    // on what one caller can spend.
    const limitSec = avatar.persona?.maxCallSeconds || env.maxCallSeconds;
    const limitTimer = setTimeout(() => endForTimeLimit(), limitSec * 1000);

    /**
     * Finishes the conversation however the call ends - a hang-up, the caller
     * closing the tab, the time limit, the job being stopped. The API finishes
     * it too on a hang-up; `finish` is idempotent, so the second one is a no-op.
     */
    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      clearTimeout(limitTimer);
      await transcript?.flush();
      await mcp?.close();
      await renderer.stop().catch((err) => logger.warn({ err: err.message }, "renderer stop failed"));
      await roomService
        .finish(conversation._id, { endReason, ...(failed && { status: "failed" }) })
        .catch((err) => logger.error({ err, conversationId: String(conversation._id) }, "finish failed"));
    };

    /**
     * Closes the room, which disconnects everyone in it - including the avatar
     * vendor, which bills for as long as it is in the room.
     */
    const closeRoom = () =>
      endRoom(ctx.room.name).catch((err) =>
        logger.warn({ err: err.message, room: ctx.room.name }, "room already closed"),
      );

    async function endForTimeLimit() {
      endReason = "time limit";
      logger.info({ room: ctx.room.name, limitSec }, "call reached its time limit");
      if (session) {
        // A goodbye beats being cut off mid-sentence, but not at any cost - a
        // stuck TTS must not keep the call (and its bill) open.
        const goodbye = session
          .generateReply({
            instructions:
              "The call has reached its time limit. Tell the caller, thank them, and say goodbye in one short sentence.",
          })
          .waitForPlayout();
        await Promise.race([goodbye, new Promise((r) => setTimeout(r, 15_000))]).catch(() => {});
      }
      await finish();
      await closeRoom();
    }

    ctx.addShutdownCallback(finish);
    ctx.room.once("disconnected", () => finish());

    /**
     * A vendor or the speech stack refusing to start. The call is marked
     * failed with the reason and the room closed, which disconnects the caller
     * - so they see it ended instead of waiting on a job that already died.
     */
    const failStart = async (err) => {
      logger.error({ err: err.message, room: ctx.room.name }, "call failed to start");
      logError({
        errorType: "CALL_FAILED",
        message: err.message,
        functionName: "agent.failStart",
        details: errorDetails(err, { room: ctx.room.name, avatar: avatar.name, provider: avatar.providerId }),
        relatedEntityType: "Conversation",
        relatedEntityId: String(conversation._id),
      });
      endReason = `failed to start: ${err.message}`;
      failed = true;
      await finish();
      await closeRoom();
    };

    if (!pipeline.available) {
      // No speech session to hand over, so only a renderer that does not
      // need one (the local stub) can run here.
      try {
        await renderer.start({ room: ctx.room, avatar });
      } catch (err) {
        await failStart(err);
        return;
      }
      logger.warn({ room: ctx.room.name }, "video-only mode; no conversation");
      await markActive(conversation);
      // Hold the job open so the track keeps publishing until the room closes.
      await new Promise((resolve) => ctx.room.once("disconnected", resolve));
      return;
    }

    session = new voice.AgentSession({
      stt: pipeline.stt,
      llm: pipeline.llm,
      tts: pipeline.tts,
    });

    // A meeting call: the avatar sits in someone's Zoom / Meet / Teams / Webex
    // meeting instead of our room. Meetings have long silences, so the
    // renderer's idle timeout is stretched; the call's time limit still caps it.
    const meetingUrl = conversation.meetingUrl;

    // The avatar starts with the session in hand and before the session does:
    // LemonSlice takes over the session's audio output so the voice is played
    // through the face. Started without it, the renderer crashed on every call
    // ("reading 'output'") and the caller sat on "Connecting..." for good.
    // Still video first: the face is up while the conversation warms up.
    try {
      await renderer.start({
        session,
        room: ctx.room,
        avatar,
        ...(meetingUrl && { idleTimeout: MEETING_IDLE_SECONDS }),
      });
    } catch (err) {
      await failStart(err);
      return;
    }

    // Joined after the renderer starts and before the session does, as the
    // LemonSlice plugin requires.
    if (meetingUrl) {
      try {
        if (typeof renderer.joinMeeting !== "function") {
          throw new Error(`${avatar.providerId} avatars cannot join external meetings`);
        }
        await renderer.joinMeeting(meetingUrl, { botName: avatar.name });
      } catch (err) {
        await failStart(err);
        return;
      }
    }

    // Keep the placeholder's pulse in step with the agent actually talking.
    session.on("agent_state_changed", (ev) => {
      renderer.setSpeaking?.(ev?.newState === "speaking");
    });

    // Every committed line - the caller's final transcript and each reply the
    // avatar actually spoke - goes to the conversation's transcript as it
    // happens. Registered before start so the greeting is captured too.
    transcript = createTranscriptRecorder({
      conversationId: conversation._id,
      workspaceId: conversation.workspaceId,
    });
    session.on("conversation_item_added", (ev) => transcript.record(ev.item));

    // The session closes itself when the caller leaves - including by closing
    // the tab, which never reaches the API. Nobody is left to talk to, so the
    // room goes too rather than idling with the avatar vendor still billing.
    session.on("close", async (ev) => {
      if (endReason === "room closed") {
        endReason = ev?.reason === "participant_disconnected" ? "caller left" : ev?.reason || "closed";
      }
      await finish();
      await closeRoom();
    });

    // The avatar's MCP servers, connected per call. A dead one is skipped
    // rather than blocking the call.
    const servers = await mcpService.forCall(avatar._id).catch(() => []);
    if (servers.length) mcp = await connectMcpTools(servers);

    try {
      await session.start({
        agent: new voice.Agent({
          instructions: instructionsFor(avatar, conversation),
          ...(mcp?.tools.length && { tools: mcp.tools }),
        }),
        room: ctx.room,
        // In a meeting, audio comes from and goes to the meeting, not our room.
        ...(meetingUrl && renderer.roomOptions()),
      });
    } catch (err) {
      await failStart(err);
      return;
    }

    // The clock starts when the call really begins: the caller is in the room
    // with their microphone and the avatar's face is up. Before that the
    // person may be answering the browser's microphone prompt, and none of it
    // is time they were able to talk. A meeting has no caller of ours to wait for.
    if (!meetingUrl) {
      const ready = await waitForCallReady(ctx.room);
      if (finished) return; // the caller left, or the room closed, while waiting
      if (!ready) {
        await failStart(new Error("the caller never joined the call (no microphone or no connection)"));
        return;
      }
    }

    await markActive(conversation);

    session.generateReply({
      instructions: avatar.persona?.greeting || "Greet the caller warmly in one sentence.",
    });
  },
});

/**
 * Ends a call that cannot start, before anything was set up for it: marks it
 * failed with the reason and closes the room so the caller is let go.
 */
async function abandon(ctx, conversation, reason) {
  logger.error({ room: ctx.room.name, reason }, "call abandoned");
  logError({
    errorType: "CALL_FAILED",
    message: reason,
    functionName: "agent.abandon",
    details: { room: ctx.room.name },
    relatedEntityType: "Conversation",
    relatedEntityId: String(conversation._id),
  });
  await roomService
    .finish(conversation._id, { endReason: reason, status: "failed" })
    .catch((err) => logger.error({ err, conversationId: String(conversation._id) }, "finish failed"));
  await endRoom(ctx.room.name).catch(() => {});
}

/**
 * Finds which conversation this job belongs to.
 *
 * The room name is the link: the API creates the Conversation before minting
 * the token, so by the time a job arrives the record already exists.
 */
async function resolveJob(ctx) {
  const roomName = ctx.room.name;
  const conversation = await Conversation.findOne({ roomName }).lean();
  if (!conversation) throw new Error(`No conversation for room "${roomName}"`);

  const avatar = await Avatar.findById(conversation.avatarId).populate("personaId voiceId").lean();
  if (!avatar) throw new Error(`Avatar ${conversation.avatarId} missing`);

  logger.info(
    { room: roomName, avatar: avatar.name, provider: avatar.providerId },
    "job resolved",
  );
  // Read per call, so a document added a minute ago is already known.
  const documents = await knowledgeService.forCall(avatar._id);

  return {
    conversation,
    avatar: { ...avatar, persona: avatar.personaId, voice: avatar.voiceId, documents },
  };
}

function instructionsFor(avatar, conversation) {
  const own =
    avatar.persona?.systemPrompt ||
    `You are ${avatar.name}, a friendly AI avatar speaking with someone over video. ` +
      `Keep replies to two or three sentences.`;
  // "Default personality" on the settings page: spoken-conversation guidance
  // added after the persona's own brief, never instead of it.
  const parts = [avatar.persona?.useDefaultPrompt ? `${own}\n\n${RECOMMENDED_PROMPT}` : own];

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

  // The knowledge base goes last: reference material, after who the avatar is
  // and who it is talking to.
  const knowledge = knowledgePrompt(avatar.documents);
  if (knowledge) parts.push(knowledge);

  return parts.join("\n\n");
}

async function markActive(conversation) {
  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { status: "active", startedAt: new Date() } },
  );
}

const cfg = livekitConfig();

// The worker registers under this name; the API dispatches to the same one.
// A mismatch is the usual reason an avatar never joins.
cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: env.livekit.agentName,
    ...(env.agent.idleProcesses && { numIdleProcesses: env.agent.idleProcesses }),
    ...(env.agent.loadThreshold && { loadThreshold: env.agent.loadThreshold }),
    ...(env.agent.initTimeoutMs && { initializeProcessTimeout: env.agent.initTimeoutMs }),
    wsURL: cfg.url,
    apiKey: cfg.apiKey,
    apiSecret: cfg.apiSecret,
  }),
);
