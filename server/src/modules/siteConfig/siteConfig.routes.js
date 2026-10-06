import { Router } from "express";
import { asyncHandler } from "../../middleware/validate.js";
import { configService } from "../admin/system/config.service.js";

/**
 * Public app config (name, logo, favicon...). Mounted at /api/config, no sign-in needed.
 *
 * Only the settings the catalog marks `public` - the same fields every
 * visitor sees on the page anyway. The server keeps it for 30 seconds so
 * page loads do not each read the database; a save clears that.
 */
const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    // Revalidated every time (cheap with the ETag) so an admin sees their own change at once.
    res.set("Cache-Control", "no-cache");
    res.json(await configService.publicConfig());
  }),
);

export default router;
