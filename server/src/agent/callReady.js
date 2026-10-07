import { RoomEvent, TrackKind } from "@livekit/rtc-node";

/**
 * When a call actually begins, for billing.
 *
 * A call is charged from the moment this resolves true, not from the moment
 * the worker picked the job up. Until then the person may still be answering
 * the browser's microphone prompt, or the avatar's face may not be up yet, and
 * none of that is time they got to talk.
 *
 * Ready means: the caller is in the room with a microphone published, and
 * the avatar's video is being published (by the vendor, or by the local stub). The caller is the
 * participant whose identity the API gave out (`user-...` or `guest-...`, see
 * createJoinToken).
 */
export const CALL_READY_TIMEOUT_MS = 90_000;

const isCaller = (p) => /^(user|guest)-/.test(p.identity || "");
const publishes = (p, kind) => [...p.trackPublications.values()].some((t) => t.kind === kind);

/** Whether the room, as it is right now, is a call in progress. */
export function callIsReady(room) {
  const others = [...room.remoteParticipants.values()];
  const caller = others.some((p) => isCaller(p) && publishes(p, TrackKind.KIND_AUDIO));
  // The face is usually another participant's (the vendor's avatar); the local
  // stub renderer publishes it from the worker itself.
  const face =
    others.some((p) => !isCaller(p) && publishes(p, TrackKind.KIND_VIDEO)) ||
    (room.localParticipant ? publishes(room.localParticipant, TrackKind.KIND_VIDEO) : false);
  return caller && face;
}

/**
 * Resolves true once the call is ready, false if it never is within the time
 * allowed or the worker is disconnected from the room first.
 *
 * @param {import("@livekit/rtc-node").Room} room
 */
export function waitForCallReady(room, timeoutMs = CALL_READY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (callIsReady(room)) return resolve(true);

    const changes = [RoomEvent.ParticipantConnected, RoomEvent.TrackPublished, RoomEvent.TrackSubscribed];
    const done = (ready) => {
      clearTimeout(timer);
      for (const event of changes) room.off(event, check);
      room.off(RoomEvent.Disconnected, gone);
      resolve(ready);
    };
    const check = () => {
      if (callIsReady(room)) done(true);
    };
    const gone = () => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);

    for (const event of changes) room.on(event, check);
    room.on(RoomEvent.Disconnected, gone);
  });
}
