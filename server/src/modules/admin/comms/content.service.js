import crypto from "node:crypto";
import path from "node:path";
import { AppNotification, DashboardCard, HeroBanner } from "../../../models/index.js";
import { getStorage } from "../../../integrations/storage/registry.js";
import { notificationHtml } from "../../comms/sanitize.js";

const notFound = (what) => Object.assign(new Error(`${what} not found`), { statusCode: 404 });

/**
 * CRUD for what an admin publishes to the app: notifications, hero banners,
 * dashboard cards. Each is a thin wrapper; the rules that matter (who sees a
 * notification, which banners rotate) live in modules/siteContent.
 */

/* ---------------------------------- notifications ---------------------------------- */

const cleanNotification = (data) => ({
  ...data,
  ...(data.message !== undefined && { message: notificationHtml(data.message) }),
  ...(data.publishDate !== undefined && { publishDate: data.publishDate ? new Date(data.publishDate) : undefined }),
});

export const notifications = {
  list: () => AppNotification.find().sort({ createdAt: -1 }).lean(),

  create: (data) =>
    AppNotification.create({ ...cleanNotification(data), publishDate: data.publishDate ? new Date(data.publishDate) : new Date() }),

  async update(id, data) {
    const patch = cleanNotification(data);
    // A cleared date means "publish when saved", the same as creating without one.
    if (data.publishDate === null) patch.publishDate = new Date();
    const doc = await AppNotification.findByIdAndUpdate(id, patch, { new: true, runValidators: true }).lean();
    if (!doc) throw notFound("Notification");
    return doc;
  },

  async remove(id) {
    if (!(await AppNotification.findByIdAndDelete(id))) throw notFound("Notification");
  },
};

/* ------------------------------------ hero banners ----------------------------------- */

export const banners = {
  list: () => HeroBanner.find().sort({ displayOrder: 1, createdAt: 1 }).lean(),
  create: (data) => HeroBanner.create(data),

  async update(id, data) {
    const doc = await HeroBanner.findByIdAndUpdate(id, data, { new: true, runValidators: true }).lean();
    if (!doc) throw notFound("Banner");
    return doc;
  },

  async remove(id) {
    if (!(await HeroBanner.findByIdAndDelete(id))) throw notFound("Banner");
  },
};

/* ---------------------------------- dashboard cards ---------------------------------- */

export const cards = {
  list: () => DashboardCard.find().sort({ displayOrder: 1, createdAt: 1 }).lean(),
  create: (data) => DashboardCard.create(data),

  async update(id, data) {
    const doc = await DashboardCard.findByIdAndUpdate(id, data, { new: true, runValidators: true }).lean();
    if (!doc) throw notFound("Card");
    return doc;
  },

  async remove(id) {
    if (!(await DashboardCard.findByIdAndDelete(id))) throw notFound("Card");
  },
};

/* ------------------------------------- uploads --------------------------------------- */

const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const VIDEO_TYPES = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const FOLDERS = new Set(["hero-banners", "dashboard-cards"]);

/**
 * Stores a banner or card picture/clip and returns its public URL.
 *
 * The type comes from what the file is declared as and is checked against an
 * allow-list - SVG is deliberately absent, since an SVG served from this
 * origin can carry script. The stored name is random and the extension comes
 * from the allow-list, never from the uploaded file name.
 */
export async function uploadMedia({ file, folder }) {
  const bad = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
  if (!file) throw bad("No file was uploaded");
  if (!FOLDERS.has(folder)) throw bad("Unknown upload folder");

  const image = IMAGE_TYPES[file.mimetype];
  const video = VIDEO_TYPES[file.mimetype];
  if (!image && !video) throw bad("Upload a JPG, PNG, WebP or GIF image, or an MP4, WebM or MOV video");
  if (image && file.size > MAX_IMAGE_BYTES) throw bad("Images can be up to 10 MB", 413);
  if (video && file.size > MAX_VIDEO_BYTES) throw bad("Videos can be up to 50 MB", 413);

  const key = path.posix.join("site", folder, `${crypto.randomUUID()}.${image || video}`);
  const stored = await getStorage().put({ buffer: file.buffer, key, contentType: file.mimetype });
  return { url: stored.publicUrl, kind: image ? "image" : "video" };
}
