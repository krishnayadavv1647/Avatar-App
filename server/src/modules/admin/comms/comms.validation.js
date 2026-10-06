import { z } from "zod";
import { audienceSchema } from "../../comms/audience.js";
import { TEMPLATE_TYPES } from "../../../models/EmailTemplate.js";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");
const byId = { params: z.object({ id: objectId }) };

/**
 * A link an admin types: a full http(s) address, or a path inside the app.
 * Anything else (javascript:, data:) is refused, because these end up in
 * hrefs that signed-in users click.
 */
const link = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v) || /^\/(?!\/)\S*$/.test(v), "Use a full http(s) address or a path like /avatars");

const email = z.string().trim().toLowerCase().email("Please enter a valid email address").max(254);
const text = (max) => z.string().trim().max(max);
const dateTime = z.string().datetime({ offset: true });

/** Icons the notification dialog offers; the client draws each by name. */
export const NOTIFICATION_ICONS = [
  "Bell", "Sparkles", "AlertCircle", "Info", "CheckCircle", "Gift", "Zap", "Video", "Heart", "BookOpen", "Shield", "Users", "CreditCard", "Key",
];

const notificationFields = {
  title: text(200).min(1, "Title is required"),
  message: z.string().max(20_000).refine((v) => v.replace(/<[^>]*>/g, "").trim().length > 0, "Message is required"),
  status: z.enum(["draft", "published", "archived"]),
  priority: z.enum(["low", "medium", "high"]),
  displayType: z.enum(["bell_only", "popup_and_bell"]),
  targetRoles: z.array(z.enum(["user", "admin"])).min(1, "Pick at least one role"),
  icon: z.enum(NOTIFICATION_ICONS),
  linkUrl: link,
  linkText: text(80),
  publishDate: dateTime.nullish(),
};

const bannerFields = {
  title: text(200).min(1, "Title and subtitle are required."),
  titleLine1: text(60),
  titleLine2: text(60),
  subtitle: text(500).min(1, "Title and subtitle are required."),
  imageUrl: link,
  backgroundImageUrl: link,
  backgroundVideoUrl: link,
  ctaText: text(40),
  ctaLink: link,
  walkthroughVideoUrl: link,
  displayOrder: z.coerce.number().int().min(-10_000).max(10_000),
  isActive: z.boolean(),
};

const cardFields = {
  title: text(120).min(1, "Title is required"),
  description: text(500).min(1, "Description is required"),
  targetPage: text(60).min(1),
  targetLink: link,
  thumbnailUrl: link,
  displayOrder: z.coerce.number().int().min(-10_000).max(10_000),
  isActive: z.boolean(),
  requiredFeature: text(60),
  isFeatureSection: z.boolean(),
  // Not shown in the dialog (as in the product this follows); kept so a record keeps what it was created with.
  iconName: text(40),
  accentColor: z.enum(["accent-blue", "accent-purple", "accent-green", "accent-orange"]),
  isLarge: z.boolean(),
};

const templateFields = {
  templateType: z.enum(TEMPLATE_TYPES),
  name: text(120).min(1, "Please fill in all required fields (Name, Subject, HTML Body)"),
  subject: text(300).min(1, "Please fill in all required fields (Name, Subject, HTML Body)"),
  fromName: text(80),
  htmlBody: z.string().min(1, "Please fill in all required fields (Name, Subject, HTML Body)").max(200_000),
  textBody: z.string().max(100_000),
  isActive: z.boolean(),
  isSystemTemplate: z.boolean(),
  placeholdersGuide: text(500),
};

const listFields = {
  name: text(120).min(1, "Please enter a list name"),
  description: text(500),
  isActive: z.boolean(),
  tags: z.array(text(40)).max(20),
};

const message = {
  subject: text(300).min(1, "Please fill in subject and message"),
  html: z.string().min(1, "Please fill in subject and message").max(200_000),
  text: z.string().max(100_000).optional(),
  fromName: text(80).optional(),
};

/** `required` fields for create, everything optional for a patch. */
const create = (fields, required) => z.object(fields).partial().required(required).strict();
const patch = (fields) => z.object(fields).partial().strict();

export const commsValidation = {
  byId,

  createNotification: {
    body: create(notificationFields, { title: true, message: true }),
  },
  updateNotification: { params: byId.params, body: patch(notificationFields) },

  createBanner: { body: create(bannerFields, { title: true, subtitle: true }) },
  updateBanner: { params: byId.params, body: patch(bannerFields) },

  createCard: { body: create(cardFields, { title: true, description: true, targetPage: true }) },
  updateCard: { params: byId.params, body: patch(cardFields) },

  createTemplate: { body: create(templateFields, { name: true, subject: true, htmlBody: true }) },
  updateTemplate: { params: byId.params, body: patch(templateFields) },
  testTemplate: { params: byId.params, body: z.object({ to: email }).strict() },

  createList: { body: create(listFields, { name: true }) },
  updateList: { params: byId.params, body: patch(listFields) },
  addMember: {
    params: byId.params,
    body: z.object({ email, fullName: text(120).optional() }).strict(),
  },
  member: { params: z.object({ id: objectId, memberId: objectId }) },

  userSearch: { query: z.object({ q: text(100).optional() }) },

  audience: { body: z.object({ audience: audienceSchema }).strict() },
  bulk: { body: z.object({ audience: audienceSchema, ...message }).strict() },
  testSend: { body: z.object({ to: email, ...message }).strict() },

  createScheduled: {
    body: z
      .object({
        title: text(160).min(1, "Please fill in all required fields."),
        subject: message.subject,
        fromName: text(80).min(1, "Please fill in all required fields."),
        htmlBody: message.html,
        textBody: message.text,
        scheduledDate: dateTime,
        audience: audienceSchema,
      })
      .strict(),
  },

  supportList: { query: z.object({}) },
  supportPatch: { params: byId.params, body: z.object({ status: z.enum(["read", "archived"]) }).strict() },
  supportReply: { params: byId.params, body: z.object({ text: z.string().trim().min(1).max(20_000) }).strict() },
  supportCompose: {
    body: z
      .object({
        to: email,
        subject: text(300).min(1),
        body: z.string().trim().min(1).max(20_000),
      })
      .strict(),
  },
};
