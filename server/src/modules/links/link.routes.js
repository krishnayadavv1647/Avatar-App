import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { linkController } from "./link.controller.js";
import { linkValidation } from "./link.validation.js";
import { validate } from "../../middleware/validate.js";

/**
 * Public, so rate limited. Starting a call is the expensive action - every one
 * reserves a room and bills by the minute - and gets the tight limit; reading
 * a link is cheap but still bounded so it cannot be hammered.
 */
const limiter = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: { error: { message: "Too many attempts. Please wait a few minutes and try again." } },
  });

const router = Router();

router.get("/:token", limiter(60 * 1000, 60), validate(linkValidation.describe), linkController.describe);
router.get(
  "/:token/preview-image",
  limiter(60 * 1000, 60),
  validate(linkValidation.describe),
  linkController.previewImage,
);
router.post(
  "/:token/calls",
  limiter(15 * 60 * 1000, 20),
  validate(linkValidation.start),
  linkController.start,
);
router.post(
  "/:token/calls/:conversationId/end",
  limiter(60 * 1000, 30),
  validate(linkValidation.end),
  linkController.end,
);

export default router;
