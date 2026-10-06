import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { previewDraftService } from "./previewDraft.service.js";
import { studioValidation } from "./studio.validation.js";
import { asyncHandler, validate } from "../../middleware/validate.js";

/** Mounted at /api/studio/preview (after sign-in and workspace): the creator's Preview. */
const router = Router();

// A preview is a short real call at the vendor, so starting one is limited.
const startLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `preview:${req.auth?.userId}`,
  validate: { keyGeneratorIpFallback: false },
  message: { error: { message: "That is a lot of previews. Wait a few minutes and try again." } },
});

// Same limits as creating a photo avatar.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const id = validate({ params: z.object({ id: z.string().max(40) }) });

router.post(
  "/photo",
  startLimit,
  upload.single("image"),
  validate(studioValidation.createFromPhoto),
  asyncHandler(async (req, res) => {
    const draft = await previewDraftService.fromPhoto({
      workspace: req.workspace,
      userId: req.auth.userId,
      file: req.file,
      ...req.body,
    });
    res.status(202).json(draft);
  }),
);

router.post(
  "/stock",
  startLimit,
  // Only the built-in Library: a vendor's own avatars already come with a clip.
  validate({
    body: studioValidation.createFromStock.body.extend({ providerId: z.literal("library") }),
  }),
  asyncHandler(async (req, res) => {
    const draft = await previewDraftService.fromLibraryFace({
      workspace: req.workspace,
      userId: req.auth.userId,
      ...req.body,
    });
    res.status(202).json(draft);
  }),
);

router.get(
  "/:id",
  id,
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await previewDraftService.status(req.workspace._id, req.params.id));
  }),
);

router.post(
  "/:id/keep",
  id,
  asyncHandler(async (req, res) => {
    res.json({ avatar: await previewDraftService.keep(req.workspace, req.params.id) });
  }),
);

router.delete(
  "/:id",
  id,
  asyncHandler(async (req, res) => {
    res.json(await previewDraftService.discard(req.workspace._id, req.params.id));
  }),
);

export default router;
