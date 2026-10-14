/**
 * Ending a call nobody is using. A user was billed 26 minutes for a call they
 * spoke in for two: the tab stayed open. After a silence the avatar checks in
 * once and, if nobody answers, the call ends - and a person speaking, or the
 * avatar mid-answer, is never "silence".
 */
import "../setup-env.js";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createIdleWatch } from "../../src/agent/idleWatch.js";

/** A watch on a clock the test moves; `tick(s)` moves it and checks, as the timer would. */
function watch(options = {}) {
  let t = 0;
  const events = [];
  const w = createIdleWatch({
    idleSeconds: 60,
    warnSeconds: 40,
    now: () => t,
    onWarn: () => events.push(`warn@${t / 1000}`),
    onIdle: () => events.push(`idle@${t / 1000}`),
    ...options,
  });
  const tick = (seconds) => {
    t += seconds * 1000;
    w.check();
  };
  return { w, tick, events };
}

describe("idle watch", () => {
  test("checks in once, then ends the call, after silence", () => {
    const { w, tick, events } = watch();
    w.start();
    tick(30);
    assert.deepEqual(events, []);
    tick(10);
    assert.deepEqual(events, ["warn@40"]);
    tick(10);
    tick(9);
    assert.deepEqual(events, ["warn@40"], "asks once, not repeatedly");
    tick(1);
    assert.deepEqual(events, ["warn@40", "idle@60"]);
  });

  test("the person speaking starts the silence again, and a later one gets its own check-in", () => {
    const { w, tick, events } = watch();
    w.start();
    tick(45);
    assert.deepEqual(events, ["warn@45"]);
    w.touch();
    tick(39);
    assert.deepEqual(events, ["warn@45"]);
    tick(1);
    assert.deepEqual(events, ["warn@45", "warn@85"]);
  });

  test("the avatar answering is not silence, however long the answer", () => {
    let speaking = true;
    const { w, tick, events } = watch({ busy: () => speaking });
    w.start();
    for (let i = 0; i < 20; i++) tick(10); // 200 s of a long answer
    assert.deepEqual(events, []);
    speaking = false;
    tick(60);
    assert.deepEqual(events.at(-1), "idle@260");
  });

  test("the check-in's own speech does not count as activity", () => {
    let speaking = false;
    const { w, tick, events } = watch({
      busy: () => speaking,
      onWarn: () => {
        speaking = true; // the avatar says "are you still there?"
      },
    });
    w.start();
    tick(40); // warns; the avatar starts talking
    assert.equal(speaking, true);
    tick(5);
    speaking = false; // finished asking, nobody answers
    tick(15);
    assert.deepEqual(events.slice(-1), ["idle@60"], "ends on schedule: one question did not buy more time");
  });

  test("stops cleanly and never fires after the call is over", () => {
    const { w, tick, events } = watch();
    w.start();
    tick(30);
    w.stop();
    tick(100);
    assert.deepEqual(events, []);
  });

  test("an idle time of zero turns it off", () => {
    const { w, events } = watch({ idleSeconds: 0 });
    w.start();
    assert.deepEqual(events, []);
    w.stop();
  });

  test("ends only once", () => {
    const { w, tick, events } = watch();
    w.start();
    tick(70);
    tick(70);
    assert.equal(events.filter((e) => e.startsWith("idle")).length, 1);
  });
});
