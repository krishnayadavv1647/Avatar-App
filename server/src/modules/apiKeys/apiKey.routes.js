import { Router } from "express";
import { z } from "zod";
import { apiKeyService } from "./apiKey.service.js";
import { asyncHandler, validate } from "../../middleware/validate.js";
import { resolveWorkspace } from "../../middleware/workspace.js";

const router = Router();
router.use(resolveWorkspace);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ keys: await apiKeyService.list(req.auth.userId) });
  }),
);

router.post(
  "/",
  validate({ body: z.object({ name: z.string().trim().min(1, "Give the key a name").max(60) }) }),
  asyncHandler(async (req, res) => {
    const key = await apiKeyService.create({
      userId: req.auth.userId,
      workspaceId: req.workspace._id,
      name: req.body.name,
    });
    res.status(201).json({ key });
  }),
);

router.delete(
  "/:id",
  validate({ params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) }) }),
  asyncHandler(async (req, res) => {
    res.json(await apiKeyService.revoke(req.auth.userId, req.params.id));
  }),
);

export default router;
