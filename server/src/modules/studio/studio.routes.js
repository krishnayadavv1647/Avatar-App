import { Router } from "express";
import multer from "multer";
import { studioController } from "./studio.controller.js";
import imageGenRoutes from "./imagegen.routes.js";
import previewDraftRoutes from "./previewDraft.routes.js";
import { studioValidation } from "./studio.validation.js";
import { validate } from "../../middleware/validate.js";
import { resolveWorkspace } from "../../middleware/workspace.js";

// Held in memory: the file goes straight to the storage driver and is never
// written to this server's disk unless the local driver puts it there.
// Separate limits so a 200 MB cap is not applied to image uploads.
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
});

const router = Router();

router.use(resolveWorkspace);

router.get("/options", studioController.options);

// Generate image / Edit image (Kie.ai).
router.use("/image", imageGenRoutes);

// Preview: a hidden draft avatar records a talking clip, then is kept or discarded.
router.use("/preview", previewDraftRoutes);
router.get("/stock", studioController.stock);
router.put(
  "/stock/gender",
  validate(studioValidation.setStockGender),
  studioController.setStockGender,
);

// No upload, so this is plain JSON rather than multipart.
router.post(
  "/stock",
  validate(studioValidation.createFromStock),
  studioController.createFromStock,
);

router.post(
  "/photo",
  uploadImage.single("image"),
  // Runs after multer so the multipart text fields exist on req.body.
  validate(studioValidation.createFromPhoto),
  studioController.createFromPhoto,
);

router.post(
  "/video",
  uploadVideo.single("video"),
  validate(studioValidation.createFromVideo),
  studioController.createFromVideo,
);

export default router;
