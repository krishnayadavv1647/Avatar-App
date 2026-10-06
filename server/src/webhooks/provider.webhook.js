import { Router } from "express";
import { trainingService } from "../avatar/training.service.js";
import { asyncHandler } from "../middleware/validate.js";
import { logger } from "../config/logger.js";
import { errorDetails, logError } from "../utils/errorLog.js";

/**
 * Inbound vendor callbacks for face training.
 *
 * Vendors are not assumed to sign these, so nothing in the body can
 * be trusted. Two things keep that safe:
 *
 *   - the callback URL carries an HMAC of the job id, so an attacker cannot
 *     address a job they do not already know about;
 *   - the payload is never written. It only prompts a fresh read from the
 *     vendor, so even a perfectly forged call cannot set a status.
 *
 * Always 200. A vendor that gets an error back will retry, and there is
 * nothing useful for it to retry into - by the time we have responded, the
 * reconciliation has already run.
 */
const router = Router();

router.post(
  "/providers/:providerId/:token",
  asyncHandler(async (req, res) => {
    const { providerId, token } = req.params;

    try {
      const result = await trainingService.handleWebhook({
        providerId,
        token,
        payload: req.body,
      });
      res.json({ received: true, ...result });
    } catch (err) {
      logger.error({ err, providerId }, "webhook handling failed");
      logError({
        errorType: "WEBHOOK_FAILED",
        message: err.message,
        functionName: `webhook.${providerId}`,
        details: errorDetails(err, { providerId }),
      });
      res.json({ received: true, matched: false });
    }
  }),
);

export default router;
