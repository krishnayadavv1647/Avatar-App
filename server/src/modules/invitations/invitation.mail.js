import { brandName, emailShell } from "../admin/admin.mail.js";

const dateLabel = (date) =>
  new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

/** The invitation email: who, which plan, until when, and the link to accept. */
export function invitationEmail({ link, planName, role, expiresAt, message }) {
  const brand = brandName();
  const shell = emailShell({
    heading: "You're invited",
    intro: `You've been invited to ${brand} - create AI avatars you can talk to. Your plan is activated the moment you accept.`,
    facts: [
      { label: "Plan", value: planName },
      { label: "Role", value: role },
      { label: "Expires", value: dateLabel(expiresAt) },
      ...(message ? [{ label: "Message", value: message }] : []),
    ],
    button: { href: link, label: "Accept invitation & activate plan" },
    note: `This invitation expires on ${dateLabel(expiresAt)}. If the button does not work, paste the link below into your browser.`,
  });
  return { subject: `You're invited to ${brand}`, ...shell };
}
