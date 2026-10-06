import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { imageGenService, MAX_EDIT_BYTES } from "./imagegen.service.js";
import { ASPECT_RATIOS, MODELS } from "../../integrations/imagegen/kie.js";
import { asyncHandler, validate } from "../../middleware/validate.js";

/** Mounted at /api/studio/image (after sign-in and workspace). */
const router = Router();

// Every picture costs money at the vendor, so starting one is limited per person.
const startLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `image:${req.auth?.userId}`,
  validate: { keyGeneratorIpFallback: false },
  message: { error: { message: "That is a lot of pictures. Wait a few minutes and try again." } },
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_EDIT_BYTES, files: 1 } });

const prompt = z.string().trim().min(3, "Describe the picture in a few words").max(1000, "Keep the description under 1000 characters");

router.post(
  "/generate",
  startLimit,
  validate({
    body: z.object({
      prompt,
      aspectRatio: z.enum(ASPECT_RATIOS).default("3:4"),
      model: z.enum(MODELS).default("flux-kontext-pro"),
    }),
  }),
  asyncHandler(async (req, res) => {
    const task = await imageGenService.generate({
      workspace: req.workspace,
      userId: req.auth.userId,
      ...req.body,
    });
    res.status(202).json(task);
  }),
);

router.post(
  "/edit",
  startLimit,
  upload.single("image"),
  // After multer, so the text field exists when it is checked.
  validate({ body: z.object({ prompt }) }),
  asyncHandler(async (req, res) => {
    const task = await imageGenService.edit({
      workspace: req.workspace,
      userId: req.auth.userId,
      file: req.file,
      prompt: req.body.prompt,
    });
    res.status(202).json(task);
  }),
);

router.get(
  "/tasks/:id",
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await imageGenService.status(req.auth.userId, req.params.id));
  }),
);

router.get(
  "/tasks/:id/file",
  asyncHandler(async (req, res) => {
    const { buffer, type } = await imageGenService.file(req.auth.userId, req.params.id);
    res.setHeader("Cache-Control", "private, no-store");
    res.type(type).send(buffer);
  }),
);

export default router;
