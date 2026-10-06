import { EmailTemplate } from "../../models/index.js";
import { brand } from "./template.js";

/**
 * The system emails the app can send, as editable templates.
 *
 * Bodies are fragments: the sender wraps every email in one branded frame, so
 * a template holds copy and a button, not a page of layout. The app's name is
 * {{appName}} rather than text, so renaming the app renames the emails.
 */
const button = (href, label) =>
  `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#111111;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">${label}</a></p>`;

const DEFAULTS = [
  {
    templateType: "welcome_email",
    name: "Welcome Email",
    subject: "Welcome to {{appName}}",
    placeholdersGuide: "{{userName}}, {{userEmail}}, {{planName}}, {{loginUrl}}, {{supportEmail}}",
    htmlBody: `<h2 style="margin:0 0 12px;">Welcome, {{userName}}!</h2>
<p>Your {{appName}} account is ready. Create an avatar, give it a voice and a brief, and start talking to it in minutes.</p>
${button("{{loginUrl}}", "Open {{appName}}")}
<p>You are on the <strong>{{planName}}</strong> plan. Need a hand? Reply to this email or write to {{supportEmail}}.</p>`,
    textBody:
      "Welcome, {{userName}}!\n\nYour {{appName}} account is ready. You are on the {{planName}} plan.\n\nSign in: {{loginUrl}}\n\nNeed a hand? Write to {{supportEmail}}.",
  },
  {
    templateType: "invitation_email",
    name: "Invitation Email",
    subject: "{{inviterName}} invited you to {{appName}}",
    placeholdersGuide: "{{userEmail}}, {{inviterName}}, {{planName}}, {{inviteLink}}, {{supportEmail}}",
    htmlBody: `<h2 style="margin:0 0 12px;">You are invited</h2>
<p>{{inviterName}} has invited you to join {{appName}} on the <strong>{{planName}}</strong> plan.</p>
${button("{{inviteLink}}", "Accept invitation")}
<p style="font-size:13px;color:#52525b;">If the button does not work, paste this link into your browser:<br>{{inviteLink}}</p>`,
    textBody:
      "{{inviterName}} has invited you to join {{appName}} on the {{planName}} plan.\n\nAccept the invitation: {{inviteLink}}",
  },
  {
    templateType: "forgot_password",
    name: "Forgot Password",
    subject: "Reset your {{appName}} password",
    placeholdersGuide: "{{userName}}, {{resetLink}}, {{supportEmail}}",
    htmlBody: `<h2 style="margin:0 0 12px;">Reset your password</h2>
<p>Hi {{userName}}, we got a request to reset your password. This link works for a short time.</p>
${button("{{resetLink}}", "Choose a new password")}
<p style="font-size:13px;color:#52525b;">Did not ask for this? You can ignore this email - your password stays as it is.</p>`,
    textBody:
      "Hi {{userName}}, we got a request to reset your {{appName}} password.\n\nChoose a new one: {{resetLink}}\n\nDid not ask for this? Ignore this email.",
  },
  {
    templateType: "plan_activated",
    name: "Plan Activated",
    subject: "Your {{planName}} plan is active",
    placeholdersGuide: "{{userName}}, {{planName}}, {{minutes}}, {{loginUrl}}",
    htmlBody: `<h2 style="margin:0 0 12px;">Your {{planName}} plan is active</h2>
<p>Hi {{userName}}, you now have <strong>{{minutes}} minutes</strong> of calls included each month on {{appName}}.</p>
${button("{{loginUrl}}", "Start a call")}`,
    textBody:
      "Hi {{userName}}, your {{planName}} plan is active: {{minutes}} minutes of calls included each month.\n\n{{loginUrl}}",
  },
  {
    templateType: "plan_updated",
    name: "Plan Updated",
    subject: "Your {{appName}} plan changed to {{planName}}",
    placeholdersGuide: "{{userName}}, {{planName}}, {{minutes}}, {{loginUrl}}",
    htmlBody: `<h2 style="margin:0 0 12px;">Your plan was updated</h2>
<p>Hi {{userName}}, your plan is now <strong>{{planName}}</strong> with {{minutes}} included minutes.</p>
${button("{{loginUrl}}", "See your usage")}`,
    textBody: "Hi {{userName}}, your plan is now {{planName}} with {{minutes}} included minutes.\n\n{{loginUrl}}",
  },
  {
    templateType: "subscription_cancelled",
    name: "Subscription Cancelled",
    subject: "Your {{appName}} subscription was cancelled",
    placeholdersGuide: "{{userName}}, {{planName}}, {{supportEmail}}",
    htmlBody: `<h2 style="margin:0 0 12px;">Subscription cancelled</h2>
<p>Hi {{userName}}, your <strong>{{planName}}</strong> subscription has been cancelled. Your avatars and conversations are kept.</p>
<p>Changed your mind, or think this is a mistake? Write to {{supportEmail}} and we will sort it out.</p>`,
    textBody:
      "Hi {{userName}}, your {{planName}} subscription has been cancelled. Your avatars and conversations are kept.\n\nQuestions? Write to {{supportEmail}}.",
  },
];

/**
 * Adds any system template that is missing, never touching ones an admin has
 * edited. Cheap enough to run on every list request.
 */
let seeding = null;

export function ensureDefaultTemplates() {
  // Two requests landing together would each see the gap and both fill it.
  seeding ||= seed().finally(() => {
    seeding = null;
  });
  return seeding;
}

async function seed() {
  const present = new Set(
    (await EmailTemplate.find({ isSystemTemplate: true }).select("templateType").lean()).map((t) => t.templateType),
  );
  const missing = DEFAULTS.filter((t) => !present.has(t.templateType));
  if (!missing.length) return 0;

  const { name } = await brand();
  await EmailTemplate.insertMany(
    missing.map((t) => ({ ...t, fromName: name, isActive: true, isSystemTemplate: true })),
  );
  return missing.length;
}
