/**
 * A call is billed from the first word spoken, not while the avatar is still
 * thinking up its greeting. A user complained credits ran during that "thinking".
 */
import "../setup-env.js";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { greetingFor, waitForFirstSpeech } from "../../src/agent/callStart.js";

const session = () => new EventEmitter();

describe("waitForFirstSpeech", () => {
  test("thinking is not speaking: only the first word starts the call", async () => {
    const s = session();
    const result = waitForFirstSpeech(s, { timeoutMs: 5_000 });
    let settled = false;
    result.then(() => (settled = true));

    s.emit("agent_state_changed", { oldState: "listening", newState: "thinking" });
    await new Promise((r) => setImmediate(r));
    assert.equal(settled, false, "still not started while the greeting is being thought up");

    s.emit("agent_state_changed", { oldState: "thinking", newState: "speaking" });
    assert.equal(await result, "agent");
  });

  test("the caller speaking first starts it too", async () => {
    const s = session();
    const result = waitForFirstSpeech(s, { timeoutMs: 5_000 });
    s.emit("user_state_changed", { oldState: "listening", newState: "speaking" });
    assert.equal(await result, "user");
  });

  test("a user going away or listening is not speech", async () => {
    const s = session();
    const result = waitForFirstSpeech(s, { timeoutMs: 40 });
    s.emit("user_state_changed", { oldState: "speaking", newState: "listening" });
    s.emit("user_state_changed", { oldState: "listening", newState: "away" });
    assert.equal(await result, null);
  });

  test("nobody speaking in time means the call never starts", async () => {
    assert.equal(await waitForFirstSpeech(session(), { timeoutMs: 30 }), null);
  });

  test("the session closing first means it never started", async () => {
    const s = session();
    const result = waitForFirstSpeech(s, { timeoutMs: 5_000 });
    s.emit("close", { reason: "participant_disconnected" });
    assert.equal(await result, null);
  });

  test("lets go of the session once it has decided", async () => {
    const s = session();
    const result = waitForFirstSpeech(s, { timeoutMs: 5_000 });
    s.emit("agent_state_changed", { newState: "speaking" });
    await result;
    for (const event of ["agent_state_changed", "user_state_changed", "close"]) {
      assert.equal(s.listenerCount(event), 0, `${event} listener removed`);
    }
  });
});

describe("greetingFor", () => {
  test("a greeting the owner wrote is spoken as written, with no model in between", () => {
    assert.deepEqual(greetingFor({ greeting: "  Hi, what can I help you with today?  " }), { say: "Hi, what can I help you with today?" });
  });

  test("with no greeting the model makes one up", () => {
    for (const persona of [undefined, {}, { greeting: "" }, { greeting: "   " }]) {
      const g = greetingFor(persona);
      assert.equal(g.say, undefined);
      assert.match(g.reply.instructions, /Greet the caller/);
    }
  });
});
