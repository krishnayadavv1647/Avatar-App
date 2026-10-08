import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { MAX_PHOTO_BYTES, profileService } from "./profile.service.js";
import { asyncHandler, validate } from "../../middleware/validate.js";
import { resolveWorkspace } from "../../middleware/workspace.js";

/** The signed-in person's own profile. Mounted at /api/profile. */
const router = Router();
router.use(resolveWorkspace);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } });

// Changing a password is a guessing target for anyone holding a stolen session.
const passwordLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `password:${req.auth?.userId}`,
  validate: { keyGeneratorIpFallback: false },
  message: { error: { message: "Too many attempts. Try again later." } },
});

const text = (max) => z.string().trim().max(max);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ profile: await profileService.get(req.auth.userId, req.workspace) });
  }),
);

router.patch(
  "/",
  validate({
    body: z
      .object({
        name: z.string().trim().min(1, "Name is required").max(80),
        title: text(80),
        phone: text(30).regex(/^[0-9+()\-.\s]*$/, "Use digits, spaces and + ( ) - only"),
        timezone: text(64),
        workspaceName: z.string().trim().min(1, "Workspace name is required").max(80),
      })
      .partial()
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    res.json({ profile: await profileService.update(req.auth.userId, req.workspace, req.body) });
  }),
);

router.put(
  "/photo",
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    res.json({ profile: await profileService.setPhoto(req.auth.userId, req.workspace, req.file) });
  }),
);

router.delete(
  "/photo",
  asyncHandler(async (req, res) => {
    res.json({ profile: await profileService.removePhoto(req.auth.userId, req.workspace) });
  }),
);

router.post(
  "/password",
  passwordLimit,
  validate({
    body: z.object({
      currentPassword: z.string().max(200).optional(),
      newPassword: z.string().min(10, "Use at least 10 characters").max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await profileService.changePassword(req.auth.userId, req.body));
  }),
);

export default router;
