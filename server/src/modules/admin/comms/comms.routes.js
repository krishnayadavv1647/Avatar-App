import { Router } from "express";
import multer from "multer";
import { asyncHandler, validate } from "../../../middleware/validate.js";
import { commsValidation as v } from "./comms.validation.js";
import { banners, cards, notifications, uploadMedia, MAX_VIDEO_BYTES } from "./content.service.js";
import { audience, lists, scheduled, sendBulk, stats, templates, testSend } from "./mailing.service.js";
import { support } from "./support.service.js";

/**
 * Admin API: notifications, hero banners, dashboard cards, mailing, support
 * mailbox. Mounted under /api/admin, behind the platform-admin guard.
 */
const router = Router();

// Held in memory and size-checked per type in the service (10 MB image, 50 MB video).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VIDEO_BYTES, files: 1 } });

const created = (fn) =>
  asyncHandler(async (req, res) => res.status(201).json(await fn(req)));
const ok = (fn) => asyncHandler(async (req, res) => res.json(await fn(req)));
const done = (fn) =>
  asyncHandler(async (req, res) => {
    await fn(req);
    res.json({ ok: true });
  });

/* ------------------------------ notifications / banners / cards ------------------------------ */

router.get("/notifications", ok(async () => ({ notifications: await notifications.list() })));
router.post("/notifications", validate(v.createNotification), created(async (req) => ({ notification: await notifications.create(req.body) })));
router.patch("/notifications/:id", validate(v.updateNotification), ok(async (req) => ({ notification: await notifications.update(req.params.id, req.body) })));
router.delete("/notifications/:id", validate(v.byId), done((req) => notifications.remove(req.params.id)));

router.get("/hero-banners", ok(async () => ({ banners: await banners.list() })));
router.post("/hero-banners", validate(v.createBanner), created(async (req) => ({ banner: await banners.create(req.body) })));
router.patch("/hero-banners/:id", validate(v.updateBanner), ok(async (req) => ({ banner: await banners.update(req.params.id, req.body) })));
router.delete("/hero-banners/:id", validate(v.byId), done((req) => banners.remove(req.params.id)));

router.get("/dashboard-cards", ok(async () => ({ cards: await cards.list() })));
router.post("/dashboard-cards", validate(v.createCard), created(async (req) => ({ card: await cards.create(req.body) })));
router.patch("/dashboard-cards/:id", validate(v.updateCard), ok(async (req) => ({ card: await cards.update(req.params.id, req.body) })));
router.delete("/dashboard-cards/:id", validate(v.byId), done((req) => cards.remove(req.params.id)));

// A banner's picture or clip, or a card's thumbnail. Multer first so `folder` is parsed.
router.post(
  "/uploads",
  upload.single("file"),
  ok((req) => uploadMedia({ file: req.file, folder: req.body?.folder })),
);

/* ------------------------------------------ mailing ------------------------------------------ */

router.get("/mailing/stats", ok(() => stats()));

router.get("/mailing/templates", ok(async () => ({ templates: await templates.list() })));
router.post("/mailing/templates", validate(v.createTemplate), created(async (req) => ({ template: await templates.create(req.body) })));
router.patch("/mailing/templates/:id", validate(v.updateTemplate), ok(async (req) => ({ template: await templates.update(req.params.id, req.body) })));
router.post("/mailing/templates/:id/test", validate(v.testTemplate), ok((req) => templates.test(req.params.id, req.body.to)));

router.get("/mailing/lists", ok(async () => ({ lists: await lists.list() })));
router.post("/mailing/lists", validate(v.createList), created(async (req) => ({ list: await lists.create(req.body) })));
router.patch("/mailing/lists/:id", validate(v.updateList), ok(async (req) => ({ list: await lists.update(req.params.id, req.body) })));
router.delete("/mailing/lists/:id", validate(v.byId), done((req) => lists.remove(req.params.id)));
router.get("/mailing/lists/:id/members", validate(v.byId), ok(async (req) => ({ members: await lists.members(req.params.id) })));
router.post("/mailing/lists/:id/members", validate(v.addMember), created(async (req) => ({ member: await lists.addMember(req.params.id, req.body) })));
router.delete("/mailing/lists/:id/members/:memberId", validate(v.member), done((req) => lists.removeMember(req.params.id, req.params.memberId)));
router.get("/mailing/lists/:id/export", validate(v.byId), ok((req) => lists.exportCsv(req.params.id)));

router.get("/mailing/users", validate(v.userSearch), ok(async (req) => ({ users: await audience.searchUsers(req.query.q) })));
router.post("/mailing/audience", validate(v.audience), ok((req) => audience.preview(req.body.audience)));
router.post("/mailing/bulk", validate(v.bulk), ok((req) => sendBulk(req.body)));
router.post("/mailing/test", validate(v.testSend), ok((req) => testSend(req.body)));

router.get("/mailing/scheduled", ok(async () => ({ emails: await scheduled.listWithCounts() })));
router.post("/mailing/scheduled", validate(v.createScheduled), created(async (req) => ({ email: await scheduled.create(req.body, req.admin._id) })));
router.post("/mailing/scheduled/run", ok(() => scheduled.runNow()));
router.post("/mailing/scheduled/:id/cancel", validate(v.byId), ok(async (req) => ({ email: await scheduled.cancel(req.params.id) })));
router.delete("/mailing/scheduled/:id", validate(v.byId), done((req) => scheduled.remove(req.params.id)));

/* --------------------------------------- support mailbox -------------------------------------- */

router.get("/support/emails", ok(async () => ({ emails: await support.list() })));
router.post("/support/emails", validate(v.supportCompose), created(async (req) => ({ email: await support.compose(req.body, req.admin) })));
router.patch("/support/emails/:id", validate(v.supportPatch), ok(async (req) => ({ email: await support.setStatus(req.params.id, req.body.status) })));
router.delete("/support/emails/:id", validate(v.byId), done((req) => support.remove(req.params.id)));
router.post("/support/emails/:id/reply", validate(v.supportReply), ok(async (req) => ({ email: await support.reply(req.params.id, req.body.text, req.admin) })));

export default router;
