/**
 * Plan management beyond limits: the presentation fields, validation, ordering
 * and the thumbnail upload.
 *
 * ADMIN_EMAILS is pinned to admin@example.com in setup-env.
 */
import "../setup-env.js";
import fs from "node:fs";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import { signUp, startTestApp } from "../helpers.js";

let app;
let admin;

before(async () => {
  app = await startTestApp();
  admin = await signUp(app.baseUrl, { email: "admin@example.com", name: "Admin" });
});

after(() => app.stop());

let counter = 0;
const createPlan = (fields = {}) =>
  admin.post("/api/admin/plans", { key: `plan-${(counter += 1)}`, name: `Plan ${counter}`, ...fields });

// The smallest valid PNG: enough for a type check, no decoder involved.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const upload = (client, { type = "image/png", name = "thumb.png", bytes = PNG } = {}) => {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  return client.upload("/api/admin/plans/thumbnail", form);
};

const onDisk = (url) => fs.existsSync(path.resolve("uploads", "plans", path.basename(new URL(url).pathname)));

describe("presentation fields", () => {
  test("have defaults: monthly, visible, order 0", async () => {
    const { body } = await createPlan();
    assert.equal(body.plan.durationType, "monthly");
    assert.equal(body.plan.visible, true);
    assert.equal(body.plan.displayOrder, 0);
  });

  test("are saved and edited", async () => {
    const { body } = await createPlan({
      durationType: "lifetime",
      visible: false,
      displayOrder: 3,
      conditionBoxDescription: "Credits do not roll over",
      purchaseUrl: "https://example.com/buy",
    });
    assert.equal(body.plan.durationType, "lifetime");
    assert.equal(body.plan.visible, false);
    assert.equal(body.plan.conditionBoxDescription, "Credits do not roll over");

    const edited = await admin.patch(`/api/admin/plans/${body.plan._id}`, { visible: true, purchaseUrl: "" });
    assert.equal(edited.body.plan.visible, true);
    assert.equal(edited.body.plan.purchaseUrl, "");
  });

  test("refuse a purchase link that is not http(s), and a duration they do not know", async () => {
    assert.equal((await createPlan({ purchaseUrl: "javascript:alert(1)" })).status, 400);
    assert.equal((await createPlan({ purchaseUrl: "ftp://example.com/x" })).status, 400);
    assert.equal((await createPlan({ thumbnailUrl: "data:text/html,hi" })).status, 400);
    assert.equal((await createPlan({ durationType: "yearly" })).status, 400);
    assert.equal((await createPlan({ displayOrder: -1 })).status, 400);
  });

  test("are listed by display order", async () => {
    const late = (await createPlan({ displayOrder: 900 })).body.plan;
    const early = (await createPlan({ displayOrder: 800 })).body.plan;
    const { body } = await admin.get("/api/admin/plans");
    const ids = body.plans.map((p) => p._id);
    assert.ok(ids.indexOf(early._id) < ids.indexOf(late._id));
  });

  test("changing a plan needs no re-sync: what it gives is read live", async () => {
    const plan = (await createPlan({ monthlyCredits: 100 })).body.plan;
    const user = await signUp(app.baseUrl);
    await admin.put(`/api/admin/users/${user.user.id}/plan`, { planId: plan._id });

    await admin.patch(`/api/admin/plans/${plan._id}`, { monthlyCredits: 500 });
    const { body } = await admin.get(`/api/admin/users/${user.user.id}/credits`);
    assert.equal(body.plan.monthlyCredits, 500);
    // 100 welcome credits at sign-up, then the plan's 100, then the 400 this edit added.
    assert.equal(body.balance, 600);
  });
});

describe("credits fields", () => {
  test("a plan gives monthly credits, or is unlimited", async () => {
    const { body } = await createPlan({ monthlyCredits: 1500 });
    assert.equal(body.plan.monthlyCredits, 1500);
    assert.equal(body.plan.unlimitedCredits, false);

    const unlimited = await admin.patch(`/api/admin/plans/${body.plan._id}`, { unlimitedCredits: true });
    assert.equal(unlimited.body.plan.unlimitedCredits, true);
  });

  test("a plan from before credits is listed at what its minutes are worth", async () => {
    const { Plan } = await import("../../src/models/index.js");
    const legacy = await Plan.create({ key: `legacy-${counter}`, name: "Legacy", includedMinutes: 50 });

    const { body } = await admin.get("/api/admin/plans");
    // 10 credits to a Standard minute.
    assert.equal(body.plans.find((p) => p._id === String(legacy._id)).monthlyCredits, 500);
  });

  test("the old minute fields are refused, as are negative credits", async () => {
    assert.equal((await createPlan({ includedMinutes: 10 })).status, 400);
    assert.equal((await createPlan({ overageEnabled: true })).status, 400);
    assert.equal((await createPlan({ monthlyCredits: -1 })).status, 400);
  });

  test("the ready-made plans give credits", async () => {
    const { body } = await admin.post("/api/admin/plans/templates");
    const byKey = Object.fromEntries(body.plans.map((p) => [p.key, p.monthlyCredits]));
    assert.deepEqual([byKey.free, byKey.starter, byKey.pro, byKey.business], [100, 1000, 4000, 12000]);
  });
});

describe("thumbnail", () => {
  test("uploads an image, which the plan can then use", async () => {
    const { status, body } = await upload(admin);
    assert.equal(status, 201);
    assert.match(body.thumbnailUrl, /\/plans\/[0-9a-f-]{36}\.png$/);
    assert.ok(onDisk(body.thumbnailUrl));

    const plan = (await createPlan({ thumbnailUrl: body.thumbnailUrl })).body.plan;
    assert.equal(plan.thumbnailUrl, body.thumbnailUrl);
  });

  test("takes only JPG, PNG and WebP of 5 MB or less", async () => {
    const gif = await upload(admin, { type: "image/gif", name: "a.gif" });
    assert.equal(gif.status, 422);
    assert.match(gif.body.error.message, /JPG, PNG or WebP/);

    const big = await upload(admin, { bytes: Buffer.alloc(5 * 1024 * 1024 + 1) });
    assert.equal(big.status, 413);

    const form = new FormData();
    assert.equal((await admin.upload("/api/admin/plans/thumbnail", form)).status, 422);
  });

  test("the old file is removed when the plan gets a new one, or is deleted", async () => {
    const first = (await upload(admin)).body.thumbnailUrl;
    const plan = (await createPlan({ thumbnailUrl: first })).body.plan;

    const second = (await upload(admin)).body.thumbnailUrl;
    await admin.patch(`/api/admin/plans/${plan._id}`, { thumbnailUrl: second });
    assert.equal(onDisk(first), false);
    assert.ok(onDisk(second));

    await admin.del(`/api/admin/plans/${plan._id}`);
    assert.equal(onDisk(second), false);
  });

  test("a URL that is not ours is stored but never makes a delete", async () => {
    const plan = (await createPlan({ thumbnailUrl: "https://cdn.example.com/pic.png" })).body.plan;
    assert.equal((await admin.del(`/api/admin/plans/${plan._id}`)).status, 200);
  });

  test("is for admins only", async () => {
    const user = await signUp(app.baseUrl);
    assert.equal((await upload(user)).status, 403);
  });
});

describe("deleting", () => {
  test("names how many users are on a plan that cannot go", async () => {
    const plan = (await createPlan()).body.plan;
    const [a, b] = [await signUp(app.baseUrl), await signUp(app.baseUrl)];
    for (const u of [a, b]) await admin.put(`/api/admin/users/${u.user.id}/plan`, { planId: plan._id });

    const refused = await admin.del(`/api/admin/plans/${plan._id}`);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error.message, /2 users are on this plan/);
  });
});
