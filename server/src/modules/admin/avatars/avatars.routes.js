import { Router } from "express";
import { z } from "zod";
import { adminAvatarsService } from "./avatars.service.js";
import { asyncHandler, validate } from "../../../middleware/validate.js";

/** Admin API: every avatar across all users. Mounted under /api/admin (platform admins only). */
const router = Router();

router.get(
  "/avatars",
  validate({
    query: z.object({
      q: z.string().trim().max(100).optional(),
      status: z.enum(["draft", "training", "ready", "failed"]).optional(),
      provider: z.string().trim().max(40).optional(),
      page: z.coerce.number().int().min(1).max(10_000).default(1),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await adminAvatarsService.list(req.query));
  }),
);

export default router;
