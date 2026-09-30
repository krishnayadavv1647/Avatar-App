import { voice } from "@livekit/agents";
import { TrackKind } from "@livekit/rtc-node";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { Avatar } from "../models/index.js";
import {
  EgressStatus,
  PREVIEW_ROOM_PREFIX,
  endRoom,
  recordTrackToR2,
  recordingInfo,
  stopRecording,
} from "../integrations/livekit/index.js";
import { agentIdOf } from "../avatar/providers/lemonslice.provider.js";
import { getRenderer } from "./renderers/registry.js";
import { buildPipelineConfig } from "./pipeline.js";

/**
 * Records an avatar's hover clip: the face saying one line, a few seconds
 * long. Runs in a `preview-` room that the API set up with nobody else in it
 * (see modules/avatars/preview.service.js), so none of a call's machinery is
 * involved - no conversation, no transcript, no usage.
 *
 *   1. start the face and the speech stack, exactly as a call does
 *   2. wait for the avatar's video track to appear
 *   3. record that track to R2 with LiveKit Egress
 *   4. say the line, let the lips finish, stop the recording
 *   5. put the clip's public URL on the avatar and close the room
 *
 * Any failure just ends the room; the avatar keeps its still picture.
 */
export const isPreviewRoom = (name) => name.startsWith(PREVIEW_ROOM_PREFIX);

// The whole job gives up after this, whatever it is waiting on.
const JOB_LIMIT_MS = 120_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Room names are `preview-<avatarId>-<suffix>`. */
const avatarIdFrom = (roomName) => roomName.slice(PREVIEW_ROOM_PREFIX.length).split("-")[0];

async function until(check, { timeoutMs, everyMs = 250, what }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

/** The first video track some other participant (the avatar) publishes. */
function avatarVideoTrackId(room) {
  for (const participant of room.remoteParticipants.values()) {
    for (const pub of participant.trackPublications.values()) {
      if (pub.kind === TrackKind.KIND_VIDEO && pub.sid) return pub.sid;
    }
  }
  return null;
}

/** Clip size in the avatar's own aspect ratio, small enough for a card. */
function clipSize(avatar) {
  const ratio = avatar.render?.aspectRatio || "2x3";
  if (ratio === "1x1") return { width: 540, height: 540 };
  if (ratio === "9x16") return { width: 432, height: 768 };
  return { width: 480, height: 720 };
}

export async function runPreview(ctx) {
  const roomName = ctx.room.name;
  const avatarId = avatarIdFrom(roomName);
  let renderer = null;
  let session = null;
  let egressId = null;

  const work = async () => {
    const doc = await Avatar.findById(avatarId).populate("personaId voiceId").lean();
    if (!doc) throw new Error(`avatar ${avatarId} not found`);
    if (agentIdOf(doc)) throw new Error("LemonSlice agents have their own clip");
    const avatar = { ...doc, persona: doc.personaId, voice: doc.voiceId, documents: [] };

    const pipeline = buildPipelineConfig(avatar);
    if (!pipeline.available) throw new Error(pipeline.reason);

    renderer = getRenderer(avatar.providerId);
    session = new voice.AgentSession({ stt: pipeline.stt, llm: pipeline.llm, tts: pipeline.tts });
    await renderer.start({ session, room: ctx.room, avatar });
    await session.start({
      agent: new voice.Agent({ instructions: `You are ${avatar.name}.` }),
      room: ctx.room,
    });

    const videoTrackId = await until(() => avatarVideoTrackId(ctx.room), {
      timeoutMs: 45_000,
      what: "the avatar's video",
    });

    const key = `${doc.workspaceId}/previews/${avatarId}-${Date.now()}.mp4`;
    const started = await recordTrackToR2({ roomName, videoTrackId, key, ...clipSize(avatar) });
    egressId = started.egressId;

    // Speaking before the recorder is running would cut the start of the line.
    await until(
      async () => (await recordingInfo(egressId))?.status === EgressStatus.EGRESS_ACTIVE,
      { timeoutMs: 20_000, everyMs: 500, what: "the recording to start" },
    );
    await sleep(700);

    const firstName = avatar.name.split(" ")[0];
    await session.say(`Hi, I'm ${firstName}. It's really nice to meet you!`).waitForPlayout();
    // The face runs a moment behind the audio; let the lips close.
    await sleep(1500);

    await stopRecording(egressId);
    const done = await until(
      async () => {
        const info = await recordingInfo(egressId);
        return info && info.status >= EgressStatus.EGRESS_COMPLETE ? info : null;
      },
      { timeoutMs: 30_000, everyMs: 1000, what: "the recording to upload" },
    );
    egressId = null;
    if (done.status !== EgressStatus.EGRESS_COMPLETE) {
      throw new Error(`recording ended as ${EgressStatus[done.status]}: ${done.error || "no detail"}`);
    }

    const url = `${env.storage.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    await Avatar.updateOne({ _id: avatarId }, { $set: { previewVideoUrl: url } });
    logger.info({ avatarId, url }, "preview clip saved");
  };

  try {
    await Promise.race([
      work(),
      sleep(JOB_LIMIT_MS).then(() => {
        throw new Error("preview took too long");
      }),
    ]);
  } catch (err) {
    logger.warn({ avatarId, room: roomName, err: err.message }, "preview clip not made");
  } finally {
    if (egressId) await stopRecording(egressId).catch(() => {});
    await session?.close().catch(() => {});
    await renderer?.stop().catch(() => {});
    // Closing the room also disconnects the avatar vendor, which bills while present.
    await endRoom(roomName).catch(() => {});
  }
}
