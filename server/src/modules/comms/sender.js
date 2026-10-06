import { mailConfigured, sendEmail } from "../../integrations/mail/index.js";
import { brand, buildMessage, recipientVars } from "./template.js";

/**
 * The one way this module sends mail to people.
 *
 * Every message goes to exactly one recipient (never a shared `to`), in batches
 * of ten with a pause between batches to stay under the provider's rate limit.
 * A failed recipient is recorded and the rest carry on.
 */

export const NOT_CONFIGURED = "Email is not configured on this server";

let transport = sendEmail;

/** Tests swap the provider for a recorder; pass nothing to restore it. */
export function setMailTransport(fn) {
  transport = fn || sendEmail;
}

/** Whether a send can go anywhere: a real provider is set up, or a test transport is installed. */
export const mailReady = () => transport !== sendEmail || mailConfigured();

export const send = (message) => transport(message);

const BATCH_SIZE = 10;
const BATCH_PAUSE_MS = 1000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ recipients: Array<{email: string, name?: string, planName?: string, minutes?: number}>,
 *           subject: string, html: string, text?: string, fromName?: string,
 *           pauseMs?: number }} input
 * @returns {Promise<{ total: number, sent: number, failed: number, errors: Array<{email: string, error: string}> }>}
 */
export async function sendToRecipients({ recipients, subject, html, text, fromName, pauseMs = BATCH_PAUSE_MS }) {
  const appBrand = await brand();
  const result = { total: recipients.length, sent: 0, failed: 0, errors: [] };

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);

    const outcomes = await Promise.all(
      batch.map(async (recipient) => {
        try {
          const message = buildMessage({
            subject,
            html,
            text,
            fromName,
            appBrand,
            vars: recipientVars(recipient, appBrand),
          });
          const res = await transport({ ...message, to: recipient.email });
          return res.ok ? null : res.error || "Send failed";
        } catch (err) {
          return err.message || "Send failed";
        }
      }),
    );

    outcomes.forEach((error, index) => {
      if (error) {
        result.failed += 1;
        result.errors.push({ email: batch[index].email, error });
      } else {
        result.sent += 1;
      }
    });

    if (i + BATCH_SIZE < recipients.length) await wait(pauseMs);
  }

  return result;
}
