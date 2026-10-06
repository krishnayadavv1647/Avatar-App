/**
 * An avatar's still picture served from the API, so the call screen's WebGL
 * animation can use it without the storage host's CORS permission.
 */
import "../setup-env.js";
import test, { after, afterEach, before, describe } from "node:test";
import assert from "node:assert/strict";
import { Avatar } from "../../src/models/index.js";
import { signUp, startTestApp } from "../helpers.js";

let app;
const realFetch = globalThis.fetch;
let remote;
const calls = [];
const PNG = Buffer.from("fake-png-bytes");

before(async () => {
  app = await startTestApp({ seed: false });
  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (address.startsWith("https://pictures.example")) {
      calls.push(address);
      return remote(address);
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
});

async function avatarWith(user, previewUrl) {
  const { body } = await user.post("/api/studio/stock", {
    providerId: "library",
    providerAvatarId: "face_f01",
    name: "Caller",
  });
  await Avatar.updateOne({ _id: body.avatar._id }, { $set: { previewUrl } });
  return body.avatar._id;
}

const image = (type = "image/png", body = PNG) => () => new Response(body, { status: 200, headers: { "content-type": type } });

const get = (user, id) =>
  fetch(`${app.baseUrl}/api/avatars/${id}/preview-image`, { headers: { authorization: `Bearer ${user.token}` } });

describe("GET /api/avatars/:id/preview-image", () => {
  test("serves the avatar's own picture, with its type, cached privately", async () => {
    remote = image("image/png");
    const user = await signUp(app.baseUrl);
    const id = await avatarWith(user, "https://pictures.example/face.png");

    const res = await get(user, id);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.match(res.headers.get("cache-control"), /private/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
    assert.deepEqual(calls, ["https://pictures.example/face.png"]);
  });

  test("is for people in the avatar's workspace only", async () => {
    remote = image();
    const owner = await signUp(app.baseUrl);
    const stranger = await signUp(app.baseUrl);
    const id = await avatarWith(owner, "https://pictures.example/face.png");

    assert.equal((await get(stranger, id)).status, 404);
    assert.equal((await fetch(`${app.baseUrl}/api/avatars/${id}/preview-image`)).status, 401);
    assert.equal(calls.length, 0, "nothing was fetched for them");
  });

  test("404 when the avatar has no picture", async () => {
    const user = await signUp(app.baseUrl);
    const id = await avatarWith(user, undefined);
    await Avatar.updateOne({ _id: id }, { $unset: { previewUrl: 1 } });
    assert.equal((await get(user, id)).status, 404);
  });

  test("says so when the picture is not an image (a clip, or a page)", async () => {
    const user = await signUp(app.baseUrl);
    const id = await avatarWith(user, "https://pictures.example/clip.mp4");

    remote = image("video/mp4");
    assert.equal((await get(user, id)).status, 415);
    remote = image("text/html", "<html></html>");
    assert.equal((await get(user, id)).status, 415);
    // An SVG can carry script; it is never passed on from here.
    remote = image("image/svg+xml", "<svg/>");
    assert.equal((await get(user, id)).status, 415);
  });

  test("a failing host is a 502, not a crash", async () => {
    const user = await signUp(app.baseUrl);
    const id = await avatarWith(user, "https://pictures.example/gone.png");
    remote = () => new Response("nope", { status: 404 });
    assert.equal((await get(user, id)).status, 502);
    remote = () => {
      throw new Error("network down");
    };
    assert.equal((await get(user, id)).status, 502);
  });

  test("refuses a picture that is too large", async () => {
    const user = await signUp(app.baseUrl);
    const id = await avatarWith(user, "https://pictures.example/huge.png");
    remote = image("image/png", Buffer.alloc(10 * 1024 * 1024 + 1));
    assert.equal((await get(user, id)).status, 502);
  });

  test("refuses a recorded address that is not a web address", async () => {
    const user = await signUp(app.baseUrl);
    const id = await avatarWith(user, "file:///etc/passwd");
    assert.equal((await get(user, id)).status, 502);
    assert.equal(calls.length, 0);
  });
});

describe("GET /api/links/:token/preview-image", () => {
  async function sharedAvatar(user, previewUrl = "https://pictures.example/face.png") {
    const id = await avatarWith(user, previewUrl);
    const { body } = await user.put(`/api/avatars/${id}/share`, { enabled: true });
    return { id, token: body.share.token };
  }
  const open = (token) => fetch(`${app.baseUrl}/api/links/${token}/preview-image`);

  test("serves the picture to anyone holding a live link, with no sign-in", async () => {
    remote = image("image/png");
    const { token } = await sharedAvatar(await signUp(app.baseUrl));

    const res = await open(token);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  });

  test("not for a link that does not exist, or has been switched off", async () => {
    remote = image();
    const owner = await signUp(app.baseUrl);
    const { id, token } = await sharedAvatar(owner);

    assert.equal((await open("nonsense-token-value")).status, 404);
    await owner.put(`/api/avatars/${id}/share`, { enabled: false });
    assert.equal((await open(token)).status, 404);
  });

  test("the same checks as the signed-in route: only images, never an SVG", async () => {
    const owner = await signUp(app.baseUrl);
    const { token } = await sharedAvatar(owner, "https://pictures.example/clip.mp4");
    remote = image("video/mp4");
    assert.equal((await open(token)).status, 415);
    remote = image("image/svg+xml", "<svg/>");
    assert.equal((await open(token)).status, 415);
  });
});
