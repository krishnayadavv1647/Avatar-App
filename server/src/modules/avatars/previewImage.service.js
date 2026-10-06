import { avatarRepository } from "./avatar.repository.js";
import { isProd } from "../../config/env.js";

/**
 * An avatar's still picture, served from this API.
 *
 * The call screen draws the face into a WebGL canvas for its connecting
 * animation, and a canvas will not take a picture from another origin unless
 * that host sends CORS headers - which a storage bucket's public address does
 * not by default. Fetching it here and passing it on makes it same-origin for
 * the browser, with no bucket configuration to get wrong.
 *
 * Only the avatar's own recorded picture is fetched (never an address from the
 * request), and only for someone in its workspace - or, through a share link
 * that is switched on, for anyone holding the link (link.service.js), who can
 * already see that picture on the link's page.
 */
const MAX_BYTES = 10 * 1024 * 1024;

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/**
 * Fetches a picture from an address the avatar was recorded with.
 * @returns {Promise<{ buffer: Buffer, type: string }>}
 */
export async function fetchPicture(address) {
  if (!address) throw fail(404, "This avatar has no picture");

  let url;
  try {
    url = new URL(address);
  } catch {
    throw fail(502, "The avatar's picture address is not valid");
  }
  // https in production; a laptop's own storage is plain http.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !isProd)) {
    throw fail(502, "The avatar's picture is not on a secure address");
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) throw fail(502, "Could not fetch the avatar's picture");

  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  // A video-only avatar has a clip where the picture would be; the caller falls back.
  // An SVG can carry script, so it is never passed on from here.
  if (!type.startsWith("image/") || type === "image/svg+xml") throw fail(415, "The avatar's picture is not an image");

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw fail(502, "The avatar's picture is too large");
  return { buffer, type };
}

export const previewImageService = {
  async get(workspaceId, avatarId) {
    const avatar = await avatarRepository.findById(workspaceId, avatarId);
    if (!avatar) throw fail(404, "Avatar not found");
    return fetchPicture(avatar.previewUrl);
  },
};
