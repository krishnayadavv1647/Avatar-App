/**
 * The creator's Preview: a hidden draft avatar records a talking clip, then is
 * kept (becomes a normal avatar) or discarded. Recording needs LiveKit Cloud and
 * a worker, so `previewService.request` is replaced here; what is tested is
 * everything around it - that a draft never shows up as an avatar, that it can
 * be kept or thrown away, and that nobody else can touch it.
 */
import "../setup-env.js";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import test, { after, afterEach, before, describe } from "node:test";
import assert from "node:assert/strict";
import { Avatar, Plan, Subscription } from "../../src/models/index.js";
import { previewService } from "../../src/modules/avatars/preview.service.js";
import { previewDraftService } from "../../src/modules/studio/previewDraft.service.js";
import { signUp, startTestApp } from "../helpers.js";

let app;
const realRequest = previewService.request;
const workspaces = [];

// Smallest valid PNG: a single transparent pixel.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

before(async () => {
  app = await startTestApp({ seed: false });
});

after(async () => {
  previewService.request = realRequest;
  await app.stop();
  for (const id of workspaces) await fs.rm(path.resolve("uploads", id), { recursive: true, force: true });
});

afterEach(() => {
  previewService.request = realRequest;
});

/** The clip "starts" (a worker would record it); nothing is recorded in the test. */
const clipStarts = () => {
  previewService.request = async () => ({ started: true });
};

async function person() {
  const user = await signUp(app.baseUrl);
  workspaces.push(String(user.user.workspaceId));
  return user;
}

const photo = (user, fields = {}) => {
  const form = new FormData();
  form.append("name", fields.name || "Untitled avatar");
  form.append("gender", fields.gender || "female");
  form.append("image", new Blob([PNG_1PX], { type: "image/png" }), "face.png");
  return user.upload("/api/studio/preview/photo", form);
};

/**
 * Makes an avatar look `ms` older. Mongoose keeps createdAt immutable, so this
 * goes round it to the driver - the one place a test needs to rewrite history.
 */
const age = (id, ms) =>
  Avatar.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { createdAt: new Date(Date.now() - ms) } });

const avatars = async (user) => (await user.get("/api/avatars")).body.avatars;

describe("starting a preview", () => {
  test("says why when no clip can be made, and leaves nothing behind", async () => {
    const user = await person();
    // In the test environment there is no LiveKit Cloud, so this is the real answer.
    const { status, body } = await photo(user);

    assert.equal(status, 409);
    assert.match(body.error.message, /Preview isn't available here: .*LiveKit/);
    assert.equal(await Avatar.countDocuments({ workspaceId: user.user.workspaceId }), 0);
  });

  test("makes a hidden draft from an uploaded photo", async () => {
    clipStarts();
    const user = await person();

    const { status, body } = await photo(user);

    assert.equal(status, 202);
    assert.match(body.avatarId, /^[0-9a-f]{24}$/);
    const draft = await Avatar.findById(body.avatarId).lean();
    assert.equal(draft.draft, true);
    assert.equal(draft.sourceType, "photo");
    // Not one of "your avatars" while it is only a preview.
    assert.deepEqual(await avatars(user), []);
  });

  test("makes a draft from a library face", async () => {
    clipStarts();
    const user = await person();

    const { status, body } = await user.post("/api/studio/preview/stock", {
      providerId: "library",
      providerAvatarId: "face_f01",
      gender: "female",
    });

    assert.equal(status, 202);
    assert.equal((await Avatar.findById(body.avatarId).lean()).draft, true);
  });

  test("only the Library: a vendor's own avatars already have a clip", async () => {
    clipStarts();
    const user = await person();
    const { status } = await user.post("/api/studio/preview/stock", {
      providerId: "mock-hosted",
      providerAvatarId: "anything",
    });
    assert.equal(status, 400);
  });

  test("a new preview replaces the person's earlier one", async () => {
    clipStarts();
    const user = await person();

    const first = (await photo(user)).body.avatarId;
    const second = (await photo(user)).body.avatarId;

    assert.equal(await Avatar.exists({ _id: first }), null);
    assert.ok(await Avatar.exists({ _id: second }));
    assert.equal(await Avatar.countDocuments({ workspaceId: user.user.workspaceId, draft: true }), 1);
  });
});

describe("following the clip", () => {
  test("is 'making' until the recording lands, then 'ready' with its address", async () => {
    clipStarts();
    const user = await person();
    const { avatarId } = (await photo(user)).body;

    assert.deepEqual((await user.get(`/api/studio/preview/${avatarId}`)).body, { status: "making" });

    await Avatar.updateOne({ _id: avatarId }, { $set: { previewVideoUrl: "https://clips.example/a.mp4" } });
    assert.deepEqual((await user.get(`/api/studio/preview/${avatarId}`)).body, {
      status: "ready",
      url: "https://clips.example/a.mp4",
    });
  });

  test("gives up on a clip that never arrives", async () => {
    clipStarts();
    const user = await person();
    const { avatarId } = (await photo(user)).body;
    await age(avatarId, 4 * 60 * 1000);

    const { body } = await user.get(`/api/studio/preview/${avatarId}`);
    assert.equal(body.status, "failed");
  });
});

describe("keeping or discarding", () => {
  test("keeping turns the draft into an ordinary avatar, with no second create", async () => {
    clipStarts();
    const user = await person();
    const { avatarId } = (await photo(user, { name: "Maya" })).body;
    await Avatar.updateOne({ _id: avatarId }, { $set: { previewVideoUrl: "https://clips.example/a.mp4" } });

    const { status, body } = await user.post(`/api/studio/preview/${avatarId}/keep`);

    assert.equal(status, 200);
    assert.equal(body.avatar._id, avatarId);
    const listed = await avatars(user);
    assert.deepEqual(listed.map((a) => [a._id, a.name]), [[avatarId, "Maya"]]);
    assert.equal(listed[0].previewVideoUrl, "https://clips.example/a.mp4");
    assert.equal((await Avatar.findById(avatarId).lean()).draft, false);
  });

  test("discarding deletes the draft", async () => {
    clipStarts();
    const user = await person();
    const { avatarId } = (await photo(user)).body;

    assert.equal((await user.del(`/api/studio/preview/${avatarId}`)).status, 200);
    assert.equal(await Avatar.exists({ _id: avatarId }), null);
  });

  test("a kept avatar can no longer be discarded through the preview", async () => {
    clipStarts();
    const user = await person();
    const { avatarId } = (await photo(user)).body;
    await user.post(`/api/studio/preview/${avatarId}/keep`);

    assert.equal((await user.del(`/api/studio/preview/${avatarId}`)).status, 404);
    assert.ok(await Avatar.exists({ _id: avatarId }), "the avatar is still there");
  });

  test("nobody else can see, keep or discard it", async () => {
    clipStarts();
    const owner = await person();
    const other = await person();
    const { avatarId } = (await photo(owner)).body;

    assert.equal((await other.get(`/api/studio/preview/${avatarId}`)).status, 404);
    assert.equal((await other.post(`/api/studio/preview/${avatarId}/keep`)).status, 404);
    assert.equal((await other.del(`/api/studio/preview/${avatarId}`)).status, 404);
    assert.equal((await fetch(`${app.baseUrl}/api/studio/preview/${avatarId}`)).status, 401);
    assert.equal((await owner.get("/api/studio/preview/not-an-id")).status, 404);
  });
});

describe("plan limits", () => {
  async function onPlanWithOneAvatar(user) {
    const plan = await Plan.create({ key: `one-${Math.random().toString(36).slice(2, 8)}`, name: "One", maxAvatars: 1 });
    await Subscription.updateOne(
      { workspaceId: user.user.workspaceId },
      { $set: { planId: plan._id, plan: plan.key } },
      { upsert: true },
    );
  }

  test("a draft is not counted as an avatar, so previewing never uses up the allowance", async () => {
    clipStarts();
    const user = await person();
    await onPlanWithOneAvatar(user);

    const { avatarId } = (await photo(user)).body;
    // A second preview still works: the first draft is not an avatar the plan has to hold.
    assert.equal((await photo(user)).status, 202);
    assert.equal(await Avatar.exists({ _id: avatarId }), null);
    const kept = (await Avatar.findOne({ workspaceId: user.user.workspaceId, draft: true }).lean())._id;
    assert.equal((await user.post(`/api/studio/preview/${kept}/keep`)).status, 200);
  });

  test("keeping is refused when the plan is already full", async () => {
    clipStarts();
    const user = await person();
    const { avatarId } = (await photo(user)).body;
    await onPlanWithOneAvatar(user);
    await Avatar.create({
      workspaceId: user.user.workspaceId,
      name: "Existing",
      sourceType: "photo",
      status: "ready",
      providerId: "mock",
    });

    const res = await user.post(`/api/studio/preview/${avatarId}/keep`);
    assert.equal(res.status, 402);
    assert.equal((await Avatar.findById(avatarId).lean()).draft, true, "still a draft");
  });
});

describe("hidden everywhere", () => {
  test("a draft is not in the admin's list of everyone's avatars", async () => {
    clipStarts();
    const admin = await signUp(app.baseUrl, { email: "admin@example.com", name: "Admin" });
    const user = await person();
    await photo(user);

    const { body } = await admin.get("/api/admin/avatars");
    assert.equal(body.avatars.filter((a) => a.owner?.email === user.email).length, 0);
  });
});

describe("sweeping", () => {
  test("removes drafts nobody kept, and leaves fresh drafts and real avatars alone", async () => {
    clipStarts();
    const user = await person();
    const kept = (await photo(user)).body.avatarId;
    await user.post(`/api/studio/preview/${kept}/keep`);

    const stale = (await photo(user)).body.avatarId;
    await age(stale, 2 * 60 * 60 * 1000);
    const fresh = await Avatar.create({
      workspaceId: user.user.workspaceId,
      name: "Fresh draft",
      sourceType: "photo",
      status: "ready",
      providerId: "mock",
      draft: true,
    });

    await previewDraftService.sweep();

    assert.equal(await Avatar.exists({ _id: stale }), null);
    assert.ok(await Avatar.exists({ _id: fresh._id }));
    assert.ok(await Avatar.exists({ _id: kept }));
  });
});
