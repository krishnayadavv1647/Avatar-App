/**
 * "Generate image" and "Edit image" in the avatar creator. Kie.ai is replaced
 * by a stand-in so nothing is spent: the tests check what we send it, what we
 * make of its answers, and who is allowed to see the result.
 */
import "../setup-env.js";
import test, { after, afterEach, before, describe } from "node:test";
import assert from "node:assert/strict";
import { env } from "../../src/config/env.js";
import { getStorage } from "../../src/integrations/storage/registry.js";
import { ErrorLog, ImageTask } from "../../src/models/index.js";
import { classifyProbe } from "../../src/modules/admin/system/apiConfig.service.js";
import { signUp, startTestApp } from "../helpers.js";

let app;
const realFetch = globalThis.fetch;

// What the stand-in Kie.ai does, set per test.
let kie;
const calls = [];
const PICTURE = Buffer.from("fake-jpeg-bytes");

/** `reachableByVendors` is a getter on the storage class; shadow it on the instance for a test, then put it back. */
const shadowReachable = (storage, value) =>
  Object.defineProperty(storage, "reachableByVendors", { value, configurable: true });
const restoreReachable = (storage) => delete storage.reachableByVendors;

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

before(async () => {
  app = await startTestApp({ seed: false });
  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (address.startsWith("https://api.kie.ai")) {
      calls.push({ url: address, body: init?.body ? JSON.parse(init.body) : null, auth: init?.headers?.Authorization });
      return kie(address, init);
    }
    if (address.startsWith("https://result.kie.test")) {
      return new Response(PICTURE, { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return realFetch(url, init);
  };
});

after(async () => {
  globalThis.fetch = realFetch;
  await app.stop();
});

afterEach(() => {
  calls.length = 0;
  env.kie.apiKey = "";
});

const works = (flag = 0, extra = {}) => (url) =>
  url.includes("record-info")
    ? reply({ code: 200, data: { successFlag: flag, response: { resultImageUrl: "https://result.kie.test/a.jpg" }, ...extra } })
    : reply({ code: 200, msg: "success", data: { taskId: "kie-task-1" } });

const start = (user, body = { prompt: "a friendly teacher" }) => user.post("/api/studio/image/generate", body);

describe("availability", () => {
  test("says whether image generation is set up, and whether editing can work", async () => {
    const user = await signUp(app.baseUrl);
    assert.deepEqual((await user.get("/api/studio/options")).body.imageGeneration, { generate: false, edit: false });

    env.kie.apiKey = "test-key";
    const storage = getStorage();
    try {
      shadowReachable(storage, false);
      assert.deepEqual((await user.get("/api/studio/options")).body.imageGeneration, { generate: true, edit: false });
      shadowReachable(storage, true);
      assert.deepEqual((await user.get("/api/studio/options")).body.imageGeneration, { generate: true, edit: true });
    } finally {
      restoreReachable(storage);
    }
  });
});

describe("generating", () => {
  test("refuses, politely, until a key is set", async () => {
    const user = await signUp(app.baseUrl);
    const { status, body } = await start(user);
    assert.equal(status, 503);
    assert.match(body.error.message, /not set up/i);
  });

  test("checks the prompt and the shape", async () => {
    env.kie.apiKey = "test-key";
    const user = await signUp(app.baseUrl);
    assert.equal((await start(user, { prompt: "a" })).status, 400);
    assert.equal((await start(user, { prompt: "x".repeat(1001) })).status, 400);
    assert.equal((await start(user, { prompt: "a face", aspectRatio: "7:3" })).status, 400);
    assert.equal(calls.length, 0);
  });

  test("starts a Flux Kontext picture from text alone and hands back a task", async () => {
    env.kie.apiKey = "test-key";
    kie = works(0);
    const user = await signUp(app.baseUrl);

    const { status, body } = await start(user, { prompt: "  a friendly teacher  ", aspectRatio: "9:16" });

    assert.equal(status, 202);
    assert.match(body.taskId, /^[0-9a-f]{24}$/);
    const sent = calls[0];
    assert.equal(sent.url, "https://api.kie.ai/api/v1/flux/kontext/generate");
    assert.equal(sent.auth, "Bearer test-key");
    assert.equal(sent.body.prompt, "a friendly teacher");
    assert.equal(sent.body.aspectRatio, "9:16");
    assert.equal(sent.body.model, "flux-kontext-pro");
    assert.equal("inputImage" in sent.body, false);
  });

  test("polls until done, then serves the picture's bytes", async () => {
    env.kie.apiKey = "test-key";
    const user = await signUp(app.baseUrl);

    kie = works(0);
    const { body: task } = await start(user);
    assert.deepEqual((await user.get(`/api/studio/image/tasks/${task.taskId}`)).body, { status: "pending" });
    assert.equal((await user.get(`/api/studio/image/tasks/${task.taskId}/file`)).status, 409);

    kie = works(1);
    assert.deepEqual((await user.get(`/api/studio/image/tasks/${task.taskId}`)).body, { status: "success" });

    const res = await fetch(`${app.baseUrl}/api/studio/image/tasks/${task.taskId}/file`, {
      headers: { authorization: `Bearer ${user.token}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PICTURE);
  });

  test("reports a failed picture, with the refusal explained", async () => {
    env.kie.apiKey = "test-key";
    const user = await signUp(app.baseUrl);

    kie = works(3, { errorMessage: "PROHIBITED_CONTENT" });
    const { body: task } = await start(user);
    const { body } = await user.get(`/api/studio/image/tasks/${task.taskId}`);
    assert.equal(body.status, "failed");
    assert.match(body.error, /refused/i);
  });

  test("a hiccup asking the vendor is not a failed picture", async () => {
    env.kie.apiKey = "test-key";
    const user = await signUp(app.baseUrl);

    kie = works(0);
    const { body: task } = await start(user);
    kie = () => reply({ msg: "boom" }, 500);
    assert.deepEqual((await user.get(`/api/studio/image/tasks/${task.taskId}`)).body, { status: "pending" });
  });

  test("gives up on a picture that never arrives", async () => {
    env.kie.apiKey = "test-key";
    const user = await signUp(app.baseUrl);

    kie = works(0);
    const { body: task } = await start(user);
    await ImageTask.updateOne({ _id: task.taskId }, { $set: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } });
    const { body } = await user.get(`/api/studio/image/tasks/${task.taskId}`);
    assert.equal(body.status, "failed");
    assert.match(body.error, /too long/i);
  });
});

describe("what the vendor's refusals become", () => {
  const cases = [
    ["a bad key", { code: 401, msg: "unauthorized" }, 503, /rejected its key/i, true],
    ["no credits", { code: 402, msg: "Credits insufficient" }, 503, /out of credits/i, true],
    ["a refused prompt", { code: 422, msg: "PROHIBITED_CONTENT" }, 422, /refused/i, false],
    ["being busy", { code: 429, msg: "rate limit" }, 429, /busy/i, false],
    ["an unknown fault", { code: 500, msg: "oops" }, 502, /could not do that/i, true],
  ];

  for (const [name, answer, status, message, logged] of cases) {
    test(`${name} -> ${status}${logged ? ", and the admin's error log" : ""}`, async () => {
      env.kie.apiKey = "test-key";
      kie = () => reply(answer); // Kie answers HTTP 200 and puts the outcome in `code`
      const user = await signUp(app.baseUrl);
      const before = await ErrorLog.countDocuments({ errorType: "IMAGE_GENERATION" });

      const res = await start(user);

      assert.equal(res.status, status);
      assert.match(res.body.error.message, message);
      await new Promise((r) => setTimeout(r, 50));
      assert.equal((await ErrorLog.countDocuments({ errorType: "IMAGE_GENERATION" })) - before, logged ? 1 : 0);
    });
  }

  test("the credit probe reads the code in the body too", () => {
    assert.equal(classifyProbe(200, { code: 401 }).outcome, "invalid");
    assert.equal(classifyProbe(200, { code: 429 }).outcome, "rate_limited");
    assert.equal(classifyProbe(200, { code: 200, data: 12 }).outcome, "valid");
    assert.equal(classifyProbe(401, null).outcome, "invalid");
  });
});

describe("whose picture it is", () => {
  test("nobody else can read, or fetch, a task", async () => {
    env.kie.apiKey = "test-key";
    kie = works(1);
    const owner = await signUp(app.baseUrl);
    const other = await signUp(app.baseUrl);

    const { body: task } = await start(owner);
    assert.equal((await owner.get(`/api/studio/image/tasks/${task.taskId}`)).status, 200);
    assert.equal((await other.get(`/api/studio/image/tasks/${task.taskId}`)).status, 404);
    assert.equal((await other.get(`/api/studio/image/tasks/${task.taskId}/file`)).status, 404);
    assert.equal((await fetch(`${app.baseUrl}/api/studio/image/tasks/${task.taskId}`)).status, 401);
    assert.equal((await owner.get("/api/studio/image/tasks/not-an-id")).status, 404);
  });

  test("a few pictures at a time, not an unlimited number", async () => {
    env.kie.apiKey = "test-key";
    kie = works(0);
    const user = await signUp(app.baseUrl);

    for (let i = 0; i < 3; i += 1) assert.equal((await start(user)).status, 202);
    const fourth = await start(user);
    assert.equal(fourth.status, 429);
    assert.match(fourth.body.error.message, /already have pictures/i);
  });
});

describe("editing", () => {
  const send = (user, { type = "image/png", bytes = Buffer.from("png"), prompt = "make the sweater red" } = {}) => {
    const form = new FormData();
    form.append("image", new Blob([bytes], { type }), "face.png");
    if (prompt !== null) form.append("prompt", prompt);
    return user.upload("/api/studio/image/edit", form);
  };

  /** Pretends the storage has a public address, as R2 does in production. */
  const withPublicStorage = async (fn) => {
    const storage = getStorage();
    shadowReachable(storage, true);
    try {
      await fn(storage);
    } finally {
      restoreReachable(storage);
    }
  };

  test("needs public storage, because the vendor fetches the source picture", async () => {
    env.kie.apiKey = "test-key";
    const user = await signUp(app.baseUrl);
    const storage = getStorage();
    shadowReachable(storage, false);
    try {
      const { status, body } = await send(user);
      assert.equal(status, 503);
      assert.match(body.error.message, /public image storage/i);
    } finally {
      restoreReachable(storage);
    }
  });

  test("sends the parked picture's address with the prompt, and tidies up when it is done", async () => {
    env.kie.apiKey = "test-key";
    kie = works(0);
    const user = await signUp(app.baseUrl);

    await withPublicStorage(async (storage) => {
      const removed = [];
      const realRemove = storage.remove.bind(storage);
      storage.remove = async (key) => {
        removed.push(key);
        return realRemove(key);
      };
      try {
        const { status, body } = await send(user);
        assert.equal(status, 202);

        const sent = calls[0].body;
        assert.equal(sent.prompt, "make the sweater red");
        assert.match(sent.inputImage, /imagegen\/.+\.png$/);
        assert.equal("aspectRatio" in sent, false);
        assert.equal(removed.length, 0, "kept while the vendor may still need it");

        kie = works(1);
        await user.get(`/api/studio/image/tasks/${body.taskId}`);
        assert.equal(removed.length, 1);
        assert.match(removed[0], /imagegen\//);
      } finally {
        storage.remove = realRemove;
      }
    });
  });

  test("takes the parked picture away again if the vendor will not start", async () => {
    env.kie.apiKey = "test-key";
    kie = () => reply({ code: 422, msg: "PROHIBITED_CONTENT" });
    const user = await signUp(app.baseUrl);

    await withPublicStorage(async (storage) => {
      const removed = [];
      const realRemove = storage.remove.bind(storage);
      storage.remove = async (key) => {
        removed.push(key);
        return realRemove(key);
      };
      try {
        assert.equal((await send(user)).status, 422);
        assert.equal(removed.length, 1);
      } finally {
        storage.remove = realRemove;
      }
    });
  });

  test("checks the picture and the prompt", async () => {
    env.kie.apiKey = "test-key";
    const user = await signUp(app.baseUrl);
    await withPublicStorage(async () => {
      assert.equal((await send(user, { type: "image/gif" })).status, 422);
      assert.equal((await send(user, { prompt: null })).status, 400);
      assert.equal((await send(user, { prompt: "x" })).status, 400);
      assert.equal(calls.length, 0);
    });
  });
});
