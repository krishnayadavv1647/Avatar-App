import { Router } from "express";
import { asyncHandler } from "../../middleware/validate.js";
import { siteContent } from "./siteContent.service.js";

/**
 * What signed-in users see: notifications and the dashboard's hero banners.
 * Mounted at /api/site.
 *
 * Dashboard cards are deliberately not served: as in the product this follows,
 * they are configured in the admin panel but not shown to end users.
 */
const router = Router();

router.get("/notifications", asyncHandler(async (req, res) => res.json(await siteContent.notifications(req.auth.userId))));
router.get("/notifications/summary", asyncHandler(async (req, res) => res.json(await siteContent.summary(req.auth.userId))));
router.post("/notifications/seen", asyncHandler(async (req, res) => res.json(await siteContent.markSeen(req.auth.userId))));

router.get("/hero-banners", asyncHandler(async (req, res) => res.json({ banners: await siteContent.banners() })));

export default router;
