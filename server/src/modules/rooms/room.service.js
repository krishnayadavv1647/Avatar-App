import crypto from "node:crypto";
import { Avatar, Conversation, Persona, Voice } from "../../models/index.js";
import { CAPABILITIES } from "../../avatar/capabilities.js";
import { getProvider } from "../../avatar/providers/registry.js";
import { createJoinToken, dispatchAgent, endRoom } from "../../integrations/livekit/index.js";
import { usageService } from "../billing/usage.service.js";
import { logger } from "../../config/logger.js";
import { env } from "../../config/env.js";
import { preflight } from "../../agent/preflight.js";

/**
 * Starting a call is where the two vendor shapes diverge, and the difference is
 * resolved here rather than in the client.
 *
 * render-only    we own the room: mint a LiveKit token, dispatch our agent
 *                worker, and it drives STT/LLM/TTS plus the avatar renderer.
 * full-pipeline  the vendor owns the conversation: ask it for a session and
 *                hand the client its transport. No agent worker runs.
 *
 * Either way the client receives the same envelope - transport, url, token -
 * so it does not branch on vendor, only on transport.
 */
// A caller has this long to get from "Start call" to connected.
const STALE_PENDING_MS = 5 * 60 * 1000;
// Longer than any call can last (a persona caps at 4 hours; the install's
// default may be set higher) plus fifteen minutes of slack.
const STALE_ACTIVE_MS = (Math.max(4 * 3600, env.maxCallSeconds) + 15 * 60) * 1000;

export const roomService = {
  /**
   * @param {{ workspace: object, avatarId: string, userId?: string,
   *           source?: "app"|"link", guest?: { name: string, email?: string } }} input
   */
  async startCall({ workspace, avatarId, userId, source = "app", guest, meetingUrl }) {
    await this.expireStale(workspace._id);

    // Checked before anything is created, so a refused call leaves no record
    // and reserves no vendor session.
    await usageService.assertCanStartCall(workspace);

    const avatar = await Avatar.findOne({ _id: avatarId, workspaceId: workspace._id }).lean();
    if (!avatar) {
      const err = new Error("Avatar not found");
      err.statusCode = 404;
      throw err;
    }
    if (avatar.status !== "ready") {
      const err = new Error(`Avatar is ${avatar.status}, not ready to call`);
      err.statusCode = 409;
      throw err;
    }

    const capabilities = CAPABILITIES[avatar.providerId];
    if (!capabilities) {
      const err = new Error(`Unknown provider "${avatar.providerId}" on this avatar`);
      err.statusCode = 500;
      throw err;
    }

    // Our worker would refuse this avatar anyway; saying so here gives the
    // caller the reason at once instead of a room that opens and closes.
    if (capabilities.pipelineMode === "render-only") {
      const [persona, voice] = await Promise.all([
        avatar.personaId ? Persona.findById(avatar.personaId).lean() : null,
        avatar.voiceId ? Voice.findById(avatar.voiceId).lean() : null,
      ]);
      const { errors } = await preflight({ ...avatar, persona, voice });
      if (errors.length) {
        const err = new Error(`This avatar cannot take calls yet: ${errors.join(" ")}`);
        err.statusCode = 422;
        throw err;
      }
    }

    // Only LemonSlice can carry an avatar into an external meeting, and only
    // through our own worker.
    if (meetingUrl && (avatar.providerId !== "lemonslice" || capabilities.pipelineMode !== "render-only")) {
      const err = new Error("Only LemonSlice avatars can join Zoom, Meet, Teams or Webex meetings.");
      err.statusCode = 422;
      throw err;
    }

    const roomName = `call-${crypto.randomUUID()}`;

    const conversation = await Conversation.create({
      workspaceId: workspace._id,
      avatarId: avatar._id,
      userId,
      source,
      guest,
      ...(meetingUrl && { meetingUrl }),
      roomName,
      providerId: avatar.providerId,
      pipelineMode: capabilities.pipelineMode,
      transport: capabilities.transport,
      status: "pending",
    });

    // Full-pipeline vendors run the conversation themselves, so the brief has
    // to travel with the session request - our agent worker never sees the call
    // and cannot apply it later.
    const persona = avatar.personaId ? await Persona.findById(avatar.personaId).lean() : null;

    // A meeting has no caller in our room to carry a token, so the agent is
    // dispatched directly and told which meeting to join.
    const connection = meetingUrl
      ? await startMeetingRoom({ conversation, avatar, roomName, meetingUrl })
      : capabilities.pipelineMode === "full-pipeline"
        ? await startVendorSession({ avatar, persona, conversation })
        : await startOwnRoom({ conversation, avatar, roomName, userId, guest });

    // Render-only calls are marked active by the agent worker when it joins.
    // Full-pipeline vendors have no worker, and they start charging the moment
    // the session exists - so the clock has to start here, or every such call
    // would meter as zero minutes and we would absorb the vendor's bill.
    if (capabilities.pipelineMode === "full-pipeline") {
      conversation.status = "active";
      conversation.startedAt = new Date();
      await conversation.save();
    }

    logger.info(
      { conversationId: conversation.id, mode: capabilities.pipelineMode, provider: avatar.providerId },
      "call started",
    );

    return { conversationId: conversation.id, ...connection };
  },

  /**
   * Closes calls that can no longer be running, so they stop holding a
   * concurrency slot.
   *
   * A call is "pending" from the moment its token is issued until the agent
   * joins; if the caller closes the tab while it is connecting, nothing else
   * ever ends it. Likewise an "active" call whose worker died. Pending gets a
   * few minutes, active its longest possible length plus slack.
   */
  async expireStale(workspaceId) {
    const now = Date.now();
    const endedAt = new Date(now);
    const [pending, active] = await Promise.all([
      Conversation.updateMany(
        { workspaceId, status: "pending", createdAt: { $lt: new Date(now - STALE_PENDING_MS) } },
        { $set: { status: "failed", endedAt, endReason: "never connected" } },
      ),
      Conversation.updateMany(
        { workspaceId, status: "active", startedAt: { $lt: new Date(now - STALE_ACTIVE_MS) } },
        { $set: { status: "ended", endedAt, endReason: "lost - no longer running" } },
      ),
    ]);
    const cleared = pending.modifiedCount + active.modifiedCount;
    if (cleared) logger.warn({ workspaceId: String(workspaceId), cleared }, "stale calls closed");
    return cleared;
  },

  async endCall({ workspace, conversationId, endReason = "hung up" }) {
    const conversation = await Conversation.findOne({
      _id: conversationId,
      workspaceId: workspace._id,
    });
    if (!conversation) {
      const err = new Error("Conversation not found");
      err.statusCode = 404;
      throw err;
    }

    if (conversation.transport === "livekit") {
      // Best effort: the room may already be gone because everyone left.
      await endRoom(conversation.roomName).catch((err) =>
        logger.warn({ err: err.message, room: conversation.roomName }, "room already closed"),
      );
    } else if (conversation.providerSessionId) {
      // Full-pipeline vendors keep billing until told to stop, so this one is
      // not optional the way closing an empty LiveKit room is.
      const provider = getProvider(conversation.providerId);
      if (typeof provider.endSession === "function") {
        try {
          await provider.endSession(conversation.providerSessionId);
        } catch (err) {
          logger.warn(
            { err: err.message, session: conversation.providerSessionId },
            "vendor session end failed",
          );
        }
      }
    }

    const { conversation: ended, entry } = await this.finish(conversation._id, { endReason });

    return {
      conversationId: ended.id,
      durationSec: ended.durationSec,
      minutes: entry.minutes,
      costCents: entry.costCents,
    };
  },

  /**
   * Marks a call ended and meters it. Safe to call more than once and from
   * more than one process at a time.
   *
   * Two things finish calls: the caller hanging up (through the API) and the
   * agent worker seeing the room close - which is the only signal at all when
   * someone simply closes the tab. Without the second, such calls stayed
   * "active" forever and counted against the concurrency limit until nobody in
   * the workspace could start a call.
   *
   * The status flip is atomic, so exactly one caller computes the duration;
   * the ledger's unique index covers the metering.
   */
  async finish(conversationId, { endReason, status = "ended" } = {}) {
    const endedAt = new Date();
    const won = await Conversation.findOneAndUpdate(
      { _id: conversationId, status: { $in: ["pending", "active"] } },
      // "failed" when the call never got going - the worker says why in endReason.
      { $set: { status, endedAt, ...(endReason && { endReason }) } },
      { new: true },
    );

    if (won?.startedAt) {
      won.durationSec = Math.round((endedAt - won.startedAt) / 1000);
      await won.save();
    }

    const conversation = won || (await Conversation.findById(conversationId));
    const entry = await usageService.recordConversation(conversation);
    return { conversation, entry };
  },
};

async function startOwnRoom({ conversation, avatar, roomName, userId, guest }) {
  const { token, serverUrl, agentName } = await createJoinToken({
    roomName,
    identity: userId ? `user-${userId}` : `guest-${conversation.id}`,
    name: guest?.name,
    metadata: { conversationId: conversation.id, avatarId: String(avatar._id) },
  });

  return { transport: "livekit", url: serverUrl, token, room: roomName, agentName };
}

async function startMeetingRoom({ conversation, avatar, roomName, meetingUrl }) {
  try {
    await dispatchAgent({
      roomName,
      metadata: { conversationId: conversation.id, avatarId: String(avatar._id), meetingUrl },
    });
  } catch (err) {
    // Nothing will ever join this room; do not leave the call holding a slot.
    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { status: "failed", endedAt: new Date(), endReason: `could not dispatch: ${err.message}` } },
    );
    throw err;
  }
  return { transport: "meeting", room: roomName };
}

async function startVendorSession({ avatar, persona, conversation }) {
  const provider = getProvider(avatar.providerId);
  const session = await provider.createSession({ avatar, persona });

  conversation.providerSessionId = session.providerSessionId;
  await conversation.save();

  return {
    transport: session.transport,
    url: session.joinUrl,
    token: session.token,
    room: session.providerSessionId,
  };
}
