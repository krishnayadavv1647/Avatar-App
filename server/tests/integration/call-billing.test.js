/**
 * What a call is billed for, and how long it may run. A user once spoke for two
 * minutes and was billed 26: the call stayed open on a share link until the
 * credits ran out. Calls are now short by default, and these are the pieces of
 * the billing that must not lose or double a charge.
 */
import "../setup-env.js";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { env } from "../../src/config/env.js";
import { Conversation, CreditTransaction, UsageLedger } from "../../src/models/index.js";
import { callLimitSeconds } from "../../src/agent/callLimit.js";
import { roomService } from "../../src/modules/rooms/room.service.js";
import { chargeMissedCalls } from "../../src/modules/billing/creditEnforcer.js";
import { signUp, startTestApp } from "../helpers.js";

let app;

before(async () => {
  app = await startTestApp({ seed: false });
});

after(() => app.stop());

async function avatarFor(user) {
  const { body } = await user.post("/api/studio/stock", { providerId: "library", providerAvatarId: "face_f01", name: "Caller" });
  return body.avatar._id;
}

const callFor = (user, avatarId, fields = {}) =>
  Conversation.create({
    workspaceId: user.user.workspaceId,
    avatarId,
    userId: user.user.id,
    roomName: `call-${Math.random().toString(36).slice(2)}`,
    providerId: "mock",
    pipelineMode: "render-only",
    transport: "livekit",
    status: "active",
    startedAt: new Date(Date.now() - 90_000),
    creditRate: 10,
    ...fields,
  });

const usage = (conversationId) => CreditTransaction.find({ kind: "usage", conversationId }).lean();

describe("how long a call may run", () => {
  test("five minutes unless the avatar says otherwise", () => {
    assert.equal(env.defaultCallSeconds, 300);
    assert.equal(callLimitSeconds(undefined), 300);
    assert.equal(callLimitSeconds({}), 300);
    assert.equal(callLimitSeconds({ maxCallSeconds: 900 }), 900);
  });

  test("the settings page is told what the default is", async () => {
    const user = await signUp(app.baseUrl);
    assert.equal((await user.get("/api/studio/options")).body.defaultCallSeconds, 300);
  });

  test("an avatar's own length wins, and a blank goes back to the default", async () => {
    const user = await signUp(app.baseUrl);
    const id = await avatarFor(user);
    assert.equal((await user.patch(`/api/avatars/${id}`, { persona: { maxCallSeconds: 1800 } })).status, 200);
    let { effective } = (await user.get(`/api/avatars/${id}/config`)).body;
    assert.deepEqual(effective.maxCallSeconds, { value: 1800, source: "avatar" });

    await user.patch(`/api/avatars/${id}`, { persona: { maxCallSeconds: "" } });
    ({ effective } = (await user.get(`/api/avatars/${id}/config`)).body);
    assert.deepEqual(effective.maxCallSeconds, { value: 300, source: "install default" });
  });
});

describe("ending a call", () => {
  test("the duration is set together with the status, and the call is charged for it", async () => {
    const user = await signUp(app.baseUrl);
    const call = await callFor(user, await avatarFor(user));

    const { conversation } = await roomService.finish(call._id, { endReason: "hung up" });
    assert.equal(conversation.status, "ended");
    assert.ok(conversation.durationSec >= 89 && conversation.durationSec <= 95, `duration ${conversation.durationSec}`);

    const charged = await usage(call._id);
    assert.equal(charged.length, 1);
    assert.ok(Math.abs(charged[0].credits + 15) < 0.6, `charged ${charged[0].credits}`);
    assert.ok((await UsageLedger.findOne({ conversationId: call._id })).minutes > 1.4);
  });

  test("two things ending the same call at once charge it once, for its real length", async () => {
    const user = await signUp(app.baseUrl);
    const call = await callFor(user, await avatarFor(user));

    // The API's hang-up and the worker seeing the room close, at the same moment.
    const results = await Promise.all([
      roomService.finish(call._id, { endReason: "hung up" }),
      roomService.finish(call._id, { endReason: "room closed" }),
      roomService.finish(call._id, { endReason: "caller left" }),
    ]);

    const charged = await usage(call._id);
    assert.equal(charged.length, 1, "charged once");
    assert.ok(charged[0].credits < -14, `charged for the real length, not zero (${charged[0].credits})`);
    const ledger = await UsageLedger.find({ conversationId: call._id }).lean();
    assert.equal(ledger.length, 1);
    assert.ok(ledger[0].minutes > 1.4, "metered for the real length, not zero minutes");
    for (const r of results) assert.ok(r.conversation.durationSec >= 89, "every caller sees the duration");
  });

  test("an end reason that starts with a dollar sign is kept as text", async () => {
    const user = await signUp(app.baseUrl);
    const call = await callFor(user, await avatarFor(user));
    const { conversation } = await roomService.finish(call._id, { endReason: "$startedAt is not a field" });
    assert.equal(conversation.endReason, "$startedAt is not a field");
  });

  test("a call that never started is not charged", async () => {
    const user = await signUp(app.baseUrl);
    const call = await callFor(user, await avatarFor(user), { status: "pending", startedAt: undefined });
    const { conversation } = await roomService.finish(call._id, { endReason: "never connected", status: "failed" });
    assert.equal(conversation.durationSec, 0);
    assert.equal((await usage(call._id)).length, 0);
  });
});

describe("a charge that did not land", () => {
  test("is caught up, once", async () => {
    const user = await signUp(app.baseUrl);
    const call = await callFor(user, await avatarFor(user), {
      status: "ended",
      endedAt: new Date(),
      durationSec: 60,
      credits: 0,
    });
    assert.equal((await usage(call._id)).length, 0);

    assert.ok((await chargeMissedCalls()) >= 1);
    const charged = await usage(call._id);
    assert.equal(charged.length, 1);
    assert.equal(charged[0].credits, -10);
    assert.equal((await Conversation.findById(call._id)).credits, 10);

    await chargeMissedCalls();
    assert.equal((await usage(call._id)).length, 1, "never twice");
  });

  test("only repairs recent calls; it does not bill history", async () => {
    const user = await signUp(app.baseUrl);
    const old = await callFor(user, await avatarFor(user), {
      status: "ended",
      endedAt: new Date(Date.now() - 3 * 3600_000),
      durationSec: 600,
      credits: 0,
    });
    await chargeMissedCalls();
    assert.equal((await usage(old._id)).length, 0);
  });
});
