/**
 * A call is charged only from when it really begins: the caller in the room
 * with a microphone, and the avatar's video up. See agent/callReady.js.
 */
import "../setup-env.js";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { RoomEvent, TrackKind } from "@livekit/rtc-node";
import { callIsReady, callerIsReady, waitForCaller, waitForCallReady } from "../../src/agent/callReady.js";

const participant = (identity, ...kinds) => ({
  identity,
  trackPublications: new Map(kinds.map((kind, i) => [`t${i}`, { kind }])),
});

function fakeRoom(...people) {
  const room = new EventEmitter();
  room.remoteParticipants = new Map(people.map((p) => [p.identity, p]));
  return room;
}

describe("call readiness", () => {
  test("not ready with only the caller", () => {
    assert.equal(callIsReady(fakeRoom(participant("user-1", TrackKind.KIND_AUDIO))), false);
  });

  test("not ready when the caller has no microphone", () => {
    assert.equal(callIsReady(fakeRoom(participant("user-1"), participant("avatar", TrackKind.KIND_VIDEO))), false);
  });

  test("ready with a caller microphone and the avatar's video", () => {
    const room = fakeRoom(participant("guest-9", TrackKind.KIND_AUDIO), participant("avatar", TrackKind.KIND_VIDEO));
    assert.equal(callIsReady(room), true);
  });

  test("a caller's own video is not the avatar's face", () => {
    const room = fakeRoom(participant("user-1", TrackKind.KIND_AUDIO, TrackKind.KIND_VIDEO));
    assert.equal(callIsReady(room), false);
  });

  test("the local stub's own video counts as the face", () => {
    const room = fakeRoom(participant("user-1", TrackKind.KIND_AUDIO));
    room.localParticipant = participant("agent", TrackKind.KIND_VIDEO);
    assert.equal(callIsReady(room), true);
  });

  test("waits, then resolves true when the microphone is published", async () => {
    const caller = participant("user-1");
    const room = fakeRoom(caller, participant("avatar", TrackKind.KIND_VIDEO));
    const waiting = waitForCallReady(room, 5_000);
    caller.trackPublications.set("mic", { kind: TrackKind.KIND_AUDIO });
    room.emit(RoomEvent.TrackPublished);
    assert.equal(await waiting, true);
  });

  test("resolves false if the caller never publishes a microphone", async () => {
    const room = fakeRoom(participant("user-1"), participant("avatar", TrackKind.KIND_VIDEO));
    assert.equal(await waitForCallReady(room, 30), false);
  });

  test("resolves false when the worker is disconnected", async () => {
    const room = fakeRoom();
    const waiting = waitForCallReady(room, 5_000);
    room.emit(RoomEvent.Disconnected);
    assert.equal(await waiting, false);
  });
});

describe("waiting for the caller alone, before the vendor is started", () => {
  test("a caller with a microphone is enough - no avatar face needed yet", () => {
    assert.equal(callerIsReady(fakeRoom(participant("user-1", TrackKind.KIND_AUDIO))), true);
    assert.equal(callIsReady(fakeRoom(participant("user-1", TrackKind.KIND_AUDIO))), false, "but the call is not ready until the face is up");
  });

  test("no microphone, or someone who is not the caller, is not enough", () => {
    assert.equal(callerIsReady(fakeRoom(participant("user-1"))), false);
    assert.equal(callerIsReady(fakeRoom(participant("avatar", TrackKind.KIND_AUDIO))), false);
    assert.equal(callerIsReady(fakeRoom()), false);
  });

  test("resolves true when the caller's microphone appears", async () => {
    const caller = participant("guest-7");
    const room = fakeRoom(caller);
    const waiting = waitForCaller(room, 5_000);
    caller.trackPublications.set("mic", { kind: TrackKind.KIND_AUDIO });
    room.emit(RoomEvent.TrackPublished);
    assert.equal(await waiting, true);
  });

  test("resolves false when the caller never allows the microphone: the vendor is never started", async () => {
    assert.equal(await waitForCaller(fakeRoom(participant("user-1")), 30), false);
  });

  test("resolves false if the worker is disconnected while waiting", async () => {
    const room = fakeRoom();
    const waiting = waitForCaller(room, 5_000);
    room.emit(RoomEvent.Disconnected);
    assert.equal(await waiting, false);
  });
});

