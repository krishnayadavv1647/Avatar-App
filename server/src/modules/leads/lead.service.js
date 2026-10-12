import { z } from "zod";
import { Avatar, Handoff, Lead, User, Workspace } from "../../models/index.js";
import { sendEmail } from "../../integrations/mail/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

/**
 * Leads and human handoffs: what a caller tells an avatar, kept as data the
 * owner can review and export.
 *
 * Both are written by tools the avatar calls during a call
 * (agent/callTools.js). The tools are given only what the avatar has switched
 * on, and the avatar's workspace and conversation come from the call itself,
 * never from anything the model says - a caller cannot make it file a lead
 * into someone else's workspace.
 */
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const leadInput = z.object({
  name: z.string().trim().max(120).optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("That email address does not look right - ask the caller to repeat it.")
    .max(200)
    .optional(),
  phone: z.string().trim().max(40).optional(),
  requirement: z.string().trim().max(1000).optional(),
});

/** Digits only, so "+91 98765-43210" and "919876543210" are the same number. */
const phoneKey = (phone) => String(phone || "").replace(/\D/g, "");

const blank = (value) => (value === "" || value == null ? undefined : value);

export const leadService = {
  /**
   * Saves or updates the lead for this caller on this avatar.
   * @returns {Promise<{ lead: object, created: boolean }>}
   */
  async capture({ workspaceId, avatarId, conversationId, guest }, raw) {
    const parsed = leadInput.safeParse({
      name: blank(raw?.name),
      email: blank(raw?.email),
      phone: blank(raw?.phone),
      requirement: blank(raw?.requirement),
    });
    if (!parsed.success) throw fail(422, parsed.error.issues[0].message);
    const input = parsed.data;

    // The share-link form already asked for a name and email; use them rather than ask again.
    const email = input.email || guest?.email;
    const name = input.name || guest?.name;
    const key = phoneKey(input.phone);
    if (input.phone && (key.length < 7 || key.length > 15)) {
      throw fail(422, "That phone number does not look right - ask the caller to repeat it with the country code.");
    }
    if (!email && !key) throw fail(422, "Ask the caller for an email address or a phone number so someone can reach them.");

    const scope = { workspaceId, avatarId };
    const existing =
      (email && (await Lead.findOne({ ...scope, email }))) ||
      (key && (await Lead.findOne({ ...scope, phoneKey: key }))) ||
      (await Lead.findOne({ ...scope, conversationIds: conversationId }));

    if (existing) {
      if (name) existing.name = name;
      if (email) existing.email = email;
      if (input.phone) {
        existing.phone = input.phone;
        existing.phoneKey = key;
      }
      if (input.requirement) existing.requirement = input.requirement;
      if (!existing.conversationIds.some((id) => String(id) === String(conversationId))) {
        existing.conversationIds.push(conversationId);
        existing.calls = existing.conversationIds.length;
      }
      existing.lastSeenAt = new Date();
      await existing.save();
      return { lead: existing.toObject(), created: false };
    }

    const lead = await Lead.create({
      ...scope,
      conversationIds: [conversationId],
      name,
      email,
      ...(input.phone && { phone: input.phone, phoneKey: key }),
      requirement: input.requirement,
    });
    return { lead: lead.toObject(), created: true };
  },

  async list(workspaceId, { avatarId, status, limit = 100 } = {}) {
    const rows = await Lead.find({
      workspaceId,
      ...(avatarId && { avatarId }),
      ...(status && { status }),
    })
      .sort({ lastSeenAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 100, 1), 500))
      .lean();
    const avatars = await Avatar.find({ _id: { $in: rows.map((r) => r.avatarId) } }).select("name").lean();
    const names = new Map(avatars.map((a) => [String(a._id), a.name]));
    return rows.map(({ phoneKey: _key, ...lead }) => ({ ...lead, avatarName: names.get(String(lead.avatarId)) || null }));
  },

  async setStatus(workspaceId, id, status) {
    const lead = await Lead.findOneAndUpdate({ _id: id, workspaceId }, { $set: { status } }, { new: true }).lean();
    if (!lead) throw fail(404, "Lead not found");
    return lead;
  },

  /** CSV a spreadsheet opens safely: cells that start like a formula are made plain text. */
  toCsv(leads) {
    const cell = (value) => {
      let text = value == null ? "" : String(value);
      if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const iso = (d) => (d?.toISOString ? d.toISOString() : d);
    const header = ["Name", "Email", "Phone", "Requirement", "Avatar", "Status", "Calls", "First seen", "Last seen"];
    const rows = leads.map((l) =>
      [l.name, l.email, l.phone, l.requirement, l.avatarName, l.status, l.calls, iso(l.createdAt), iso(l.lastSeenAt)]
        .map(cell)
        .join(","),
    );
    return [header.map(cell).join(","), ...rows].join("\r\n");
  },

  /**
   * Records that a caller wants a person, then tells the owner.
   * The record comes first: if the email cannot be sent it is still there.
   */
  async requestHuman({ workspaceId, avatarId, conversationId, guest }, raw) {
    const contact = String(raw?.contact || guest?.email || "").trim().slice(0, 200);
    const reason = String(raw?.reason || "").trim().slice(0, 1000);
    if (!contact) throw fail(422, "Ask the caller how the team can reach them - an email address or a phone number.");
    if (!reason) throw fail(422, "Ask the caller briefly what they need help with.");

    const duplicate = await Handoff.findOne({ workspaceId, conversationId, status: "open" });
    if (duplicate) return { handoff: duplicate.toObject(), created: false };

    const handoff = await Handoff.create({
      workspaceId,
      avatarId,
      conversationId,
      name: String(raw?.name || guest?.name || "").trim().slice(0, 120) || undefined,
      contact,
      reason,
      preferredTime: String(raw?.preferredTime || "").trim().slice(0, 120) || undefined,
    });

    await notifyOwner(handoff).catch((err) => logger.warn({ err: err.message }, "handoff notification failed"));
    return { handoff: (await Handoff.findById(handoff._id)).toObject(), created: true };
  },

  async listHandoffs(workspaceId, { status, limit = 100 } = {}) {
    const rows = await Handoff.find({ workspaceId, ...(status && { status }) })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(Number(limit) || 100, 1), 500))
      .lean();
    const avatars = await Avatar.find({ _id: { $in: rows.map((r) => r.avatarId) } }).select("name").lean();
    const names = new Map(avatars.map((a) => [String(a._id), a.name]));
    return rows.map((h) => ({ ...h, avatarName: names.get(String(h.avatarId)) || null }));
  },

  async setHandoffStatus(workspaceId, id, status) {
    const handoff = await Handoff.findOneAndUpdate({ _id: id, workspaceId }, { $set: { status } }, { new: true }).lean();
    if (!handoff) throw fail(404, "Request not found");
    return handoff;
  },
};

async function notifyOwner(handoff) {
  const workspace = await Workspace.findById(handoff.workspaceId).select("ownerId").lean();
  const owner = workspace && (await User.findById(workspace.ownerId).select("email").lean());
  const avatar = await Avatar.findById(handoff.avatarId).select("name").lean();
  const link = `${env.clientOrigin.replace(/\/$/, "")}/conversations/${handoff.conversationId}`;

  const lines = [
    `${handoff.name || "A caller"} asked ${avatar?.name || "your avatar"} for a person.`,
    "",
    `Reason: ${handoff.reason}`,
    `Contact: ${handoff.contact}`,
    ...(handoff.preferredTime ? [`Best time: ${handoff.preferredTime}`] : []),
    "",
    `The conversation: ${link}`,
  ];
  const result = owner?.email
    ? await sendEmail({
        to: owner.email,
        subject: `Someone wants to talk to a person (${avatar?.name || "avatar"})`,
        text: lines.join("\n"),
      })
    : { ok: false, error: "No owner email on file" };

  await Handoff.updateOne(
    { _id: handoff._id },
    { $set: { notified: Boolean(result.ok), ...(result.ok ? {} : { notifyError: result.error }) } },
  );
}
