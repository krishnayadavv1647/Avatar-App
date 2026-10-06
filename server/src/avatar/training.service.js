import crypto from "node:crypto";
import { Avatar, TrainingJob } from "../models/index.js";
import { getProvider } from "./providers/registry.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { logError } from "../utils/errorLog.js";

/**
 * Resolving asynchronous face training.
 *
 * Two paths reach the same place, deliberately:
 *
 *   webhook  the vendor tells us the moment it finishes. Fast, but not
 *            trustworthy on its own - vendors are not assumed to sign, and a webhook
 *            can simply be missed while we are deploying.
 *
 *   polling  we ask. Slower, but authoritative, and it is what makes a missed
 *            or forged webhook harmless: a webhook never carries the outcome,
 *            it only prompts us to go and check.
 *
 * That is the important bit. `handleWebhook` does not write the status it was
 * given; it re-reads from the vendor. A forged "training succeeded" therefore
 * achieves nothing beyond an extra API call.
 */
export const trainingService = {
  /** Unguessable callback URL. Vendors may not sign, so the URL is the secret. */
  callbackUrlFor(job) {
    if (!env.webhookSecret || !env.publicBaseUrl) return undefined;
    return `${env.publicBaseUrl}/api/webhooks/providers/${job.providerId}/${signJob(job)}`;
  },

  async createJob({ avatarId, providerId, providerJobId }) {
    return TrainingJob.create({
      avatarId,
      providerId,
      providerJobId,
      status: "queued",
      startedAt: new Date(),
    });
  },

  /**
   * Asks the vendor where a job stands and applies the answer.
   * Safe to call repeatedly; terminal jobs short-circuit.
   */
  async reconcile(jobId) {
    const job = await TrainingJob.findById(jobId);
    if (!job) return null;
    if (job.status === "succeeded" || job.status === "failed") return job;

    const provider = getProvider(job.providerId);

    let result;
    try {
      result = await provider.getTrainingStatus(job.providerJobId);
    } catch (err) {
      job.attempts += 1;
      job.error = err.message;
      // A vendor hiccup is not a training failure; leave the job open unless
      // it has failed often enough to be worth surfacing.
      if (job.attempts >= 10) {
        job.status = "failed";
        job.finishedAt = new Date();
      }
      await job.save();
      logger.warn({ jobId, attempts: job.attempts, err: err.message }, "training poll failed");
      return job;
    }

    job.status = result.status;
    job.progress = result.progress ?? job.progress;
    job.error = result.error;
    if (result.status === "succeeded" || result.status === "failed") {
      job.finishedAt = new Date();
    }
    await job.save();

    await applyToAvatar(job, result);
    return job;
  },

  /**
   * Called by the webhook route. The payload is treated purely as a hint - the
   * outcome always comes from a fresh vendor read.
   */
  async handleWebhook({ providerId, token, payload }) {
    const job = await findJobForWebhook({ providerId, token, payload });
    if (!job) {
      logger.warn({ providerId }, "webhook did not match a known job");
      return { matched: false };
    }

    logger.info({ jobId: job.id, providerId }, "webhook received; re-reading vendor status");
    await this.reconcile(job._id);
    return { matched: true, jobId: job.id };
  },

  /** Jobs still open, for the reconciliation worker. */
  pendingJobs(limit = 50) {
    return TrainingJob.find({ status: { $in: ["queued", "running"] } })
      .sort({ updatedAt: 1 })
      .limit(limit)
      .lean();
  },
};

async function applyToAvatar(job, result) {
  if (result.status === "succeeded") {
    await Avatar.updateOne(
      { _id: job.avatarId },
      {
        $set: {
          status: "ready",
          providerAvatarId: result.providerAvatarId || job.providerJobId,
          ...(result.previewUrl ? { previewUrl: result.previewUrl } : {}),
        },
        $unset: { failureReason: "" },
      },
    );
    logger.info({ avatarId: String(job.avatarId) }, "avatar training succeeded");
  } else if (result.status === "failed") {
    await Avatar.updateOne(
      { _id: job.avatarId },
      { $set: { status: "failed", failureReason: result.error || "Training failed" } },
    );
    logger.warn({ avatarId: String(job.avatarId), error: result.error }, "avatar training failed");
    logError({
      errorType: "TRAINING_FAILED",
      message: result.error || "Training failed",
      functionName: "training.reconcile",
      severity: "WARNING",
      details: { jobId: String(job._id), providerId: job.providerId },
      relatedEntityType: "Avatar",
      relatedEntityId: String(job.avatarId),
    });
  }
}

/**
 * The token proves the caller knows a secret derived from the job id, so an
 * attacker cannot fabricate one for a job they do not know about.
 */
function signJob(job) {
  const id = String(job._id || job.id);
  const mac = crypto
    .createHmac("sha256", env.webhookSecret)
    .update(id)
    .digest("hex")
    .slice(0, 32);
  return `${id}.${mac}`;
}

function verifyToken(token) {
  if (!env.webhookSecret || !token) return null;

  const [id, mac] = token.split(".");
  if (!id || !mac) return null;

  const expected = crypto
    .createHmac("sha256", env.webhookSecret)
    .update(id)
    .digest("hex")
    .slice(0, 32);

  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return id;
}

async function findJobForWebhook({ providerId, token, payload }) {
  const jobId = verifyToken(token);
  if (jobId) return TrainingJob.findById(jobId);

  // No usable token. Fall back to the vendor's own id, which is not a secret -
  // hence the re-read in handleWebhook rather than trusting the payload.
  const vendorId = payload?.face_id || payload?.replica_id;
  if (!vendorId) return null;
  return TrainingJob.findOne({ providerId, providerJobId: vendorId });
}

export { verifyToken, signJob };
