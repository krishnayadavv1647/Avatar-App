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
import { clipSizeFor } from "./clipSize.js";

/**
 * Records an avatar's hover clip: the face saying one line, a few seconds
 * long. Runs in a `preview-` room that the API set up with nobody else in it
 * (see modules/avatars/preview.service.js), so none of a call's machinery is
 * involved - no conversation, no transcript, no usage.
 *
 *   1. start the face and the speech stack, exactly as a call does
 *   2. wait for the avatar's video track to appear
 *   3. start the avatar talking, then record that track to R2 with LiveKit Egress
 *   4. let it finish, let the lips close, stop the recording
 *   5. put the clip's public URL on the avatar and close the room
 *
 * Talking starts BEFORE the recorder does. The recorder takes a few seconds to
 * come up, and a clip that began when it did - then waited for speech to be
 * synthesised and the lips to catch up - opened on several seconds of a face
 * just looking at the camera. The clip is muted and loops, so beginning
 * partway through a sentence is invisible; beginning in silence is not.
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

/** The first video track some other participant (the avatar) publishes, with its size once known. */
function avatarVideoTrack(room) {
  for (const participant of room.remoteParticipants.values()) {
    for (const pub of participant.trackPublications.values()) {
      if (pub.kind === TrackKind.KIND_VIDEO && pub.sid) return { sid: pub.sid, width: pub.width, height: pub.height };
    }
  }
  return null;
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

    const track = await until(() => avatarVideoTrack(ctx.room), {
      timeoutMs: 45_000,
      what: "the avatar's video",
    });

    // The track's real size, so the recording has the same shape and no black bars.
    // Not known the instant the track appears; if it never is, the nominal shape is used.
    const sized = await until(
      () => {
        const t = avatarVideoTrack(ctx.room);
        return t?.width > 0 && t?.height > 0 ? t : null;
      },
      { timeoutMs: 5_000, everyMs: 200, what: "the avatar's video size" },
    ).catch(() => track);
    const size = clipSizeFor({
      trackWidth: sized.width,
      trackHeight: sized.height,
      aspectRatio: avatar.render?.aspectRatio,
    });
    logger.info({ avatarId, track: { width: sized.width, height: sized.height }, size }, "recording preview clip");

    // Talk first, record second: by the time the recorder is up the face is
    // already mid-sentence. Two lines are queued so there is speech to record
    // however long the recorder takes to start.
    const firstName = avatar.name.split(" ")[0];
    const lines = [
      session.say(`Hi, I'm ${firstName}. It's really nice to meet you!`, { allowInterruptions: false }),
      session.say("I'm here whenever you'd like to talk, so ask me anything.", { allowInterruptions: false }),
    ];
    let talking = true;
    // A line that cannot be played must not fail the clip: it is recorded either way.
    const talked = Promise.all(lines.map((line) => line.waitForPlayout()))
      .catch(() => {})
      .finally(() => {
        talking = false;
      });

    const key = `${doc.workspaceId}/previews/${avatarId}-${Date.now()}.mp4`;
    const startedAt = Date.now();
    const started = await recordTrackToR2({ roomName, videoTrackId: track.sid, key, ...size });
    egressId = started.egressId;

    await until(
      async () => (await recordingInfo(egressId))?.status === EgressStatus.EGRESS_ACTIVE,
      { timeoutMs: 20_000, everyMs: 200, what: "the recording to start" },
    );
    logger.info({ avatarId, recorderMs: Date.now() - startedAt, stillTalking: talking }, "preview recorder is up");

    // A very slow recorder can outlast both lines; then there is nothing to
    // record, so say one more, now that it is running.
    if (!talking) await session.say("It's lovely to meet you!", { allowInterruptions: false }).waitForPlayout();
    else await talked;

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
