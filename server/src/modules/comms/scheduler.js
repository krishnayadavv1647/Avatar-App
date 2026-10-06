import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { ScheduledEmail } from "../../models/index.js";
import { logError } from "../../utils/errorLog.js";
import { resolveAudience } from "./audience.js";
import { mailReady, NOT_CONFIGURED, sendToRecipients } from "./sender.js";

const TICK_MS = 60_000;
// A send that has been "sending" this long was cut off by a restart; leaving it
// would show it as in progress forever.
const STALE_MS = 30 * 60_000;

let running = false;

/**
 * Sends every scheduled email that has come due.
 *
 * Each one is claimed with a single findOneAndUpdate (pending -> sending), so
 * when two instances tick together only one wins a given email and nothing is
 * sent twice. With mail unconfigured nothing is claimed: the emails stay
 * pending and go out once it is set up, instead of being burned as failures.
 *
 * @param {{ now?: Date, pauseMs?: number }} [options]
 * @returns {Promise<{ processed: number, skipped?: string }>}
 */
export async function processDueScheduledEmails({ now = new Date(), pauseMs } = {}) {
  if (!mailReady()) return { processed: 0, skipped: NOT_CONFIGURED };

  await ScheduledEmail.updateMany(
    { status: "sending", startedAt: { $lt: new Date(now.getTime() - STALE_MS) } },
    { status: "failed", errorMessage: "Interrupted before it finished sending", sentDate: now },
  );

  let processed = 0;
  for (;;) {
    const email = await ScheduledEmail.findOneAndUpdate(
      { status: "pending", scheduledDate: { $lte: now } },
      { status: "sending", startedAt: new Date() },
      { sort: { scheduledDate: 1 }, new: true },
    );
    if (!email) break;

    try {
      const recipients = await resolveAudience(email.audience);
      const result = await sendToRecipients({
        recipients,
        subject: email.subject,
        html: email.htmlBody,
        text: email.textBody,
        fromName: email.fromName,
        pauseMs,
      });

      const nothingWentOut = result.total > 0 && result.sent === 0;
      await ScheduledEmail.updateOne(
        { _id: email._id },
        {
          status: nothingWentOut ? "failed" : "sent",
          sentCount: result.sent,
          failedCount: result.failed,
          sentDate: new Date(),
          errorMessage: result.errors[0]?.error,
        },
      );
    } catch (err) {
      logger.error({ err, id: String(email._id) }, "scheduled email failed");
      logError({
        errorType: "SCHEDULED_EMAIL_FAILED",
        message: err.message,
        functionName: "processDueScheduledEmails",
        relatedEntityType: "ScheduledEmail",
        relatedEntityId: String(email._id),
      });
      await ScheduledEmail.updateOne(
        { _id: email._id },
        { status: "failed", errorMessage: err.message, sentDate: new Date() },
      );
    }
    processed += 1;
  }

  return { processed };
}

/**
 * Checks for due emails once a minute, for as long as the server runs.
 * Off under test, where nothing should send behind a test's back.
 */
export function startScheduledEmailLoop() {
  if (env.nodeEnv === "test") return null;

  const timer = setInterval(async () => {
    // A long send must not be overlapped by the next tick of the same process.
    if (running) return;
    running = true;
    try {
      await processDueScheduledEmails();
    } catch (err) {
      logger.warn({ err: err.message }, "scheduled email tick failed");
    } finally {
      running = false;
    }
  }, TICK_MS);
  timer.unref();
  return timer;
}
