import { Router } from "express";
import { impersonationService } from "../admin/impersonation.service.js";
import { asyncHandler } from "../../middleware/validate.js";

/** POST /api/impersonation/end - an admin acting as a user says they are done. */
const router = Router();

router.post(
  "/end",
  asyncHandler(async (req, res) => {
    if (req.auth?.impersonatedBy) {
      await impersonationService.end({
        adminId: req.auth.impersonatedBy,
        userId: req.auth.userId,
        workspaceId: req.auth.workspaceId,
        ip: req.ip,
      });
    }
    res.json({ ok: true });
  }),
);

export default router;
