import {
  EmailList,
  EmailListMember,
  EmailTemplate,
  ScheduledEmail,
  Subscription,
  User,
} from "../../../models/index.js";
import { resolveAudience } from "../../comms/audience.js";
import { NOT_CONFIGURED, mailReady, send, sendToRecipients } from "../../comms/sender.js";
import { processDueScheduledEmails } from "../../comms/scheduler.js";
import { ensureDefaultTemplates } from "../../comms/templates.seed.js";
import { brand, buildMessage, sampleVars } from "../../comms/template.js";

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const notFound = (what) => fail(`${what} not found`, 404);

/** Refuses up front when nothing could be sent, so the UI says why rather than reporting a fake success. */
const requireMail = () => {
  if (!mailReady()) throw fail(NOT_CONFIGURED, 503);
};

/** Most a single send may reach; a bigger audience belongs in a scheduled email or a list tool. */
const MAX_BULK_RECIPIENTS = 5000;

/* ----------------------------------- templates ----------------------------------- */

export const templates = {
  async list() {
    await ensureDefaultTemplates();
    return EmailTemplate.find().sort({ isSystemTemplate: -1, createdAt: 1 }).lean();
  },

  create: (data) => EmailTemplate.create(data),

  async update(id, data) {
    const doc = await EmailTemplate.findByIdAndUpdate(id, data, { new: true, runValidators: true }).lean();
    if (!doc) throw notFound("Template");
    return doc;
  },

  /** Sends one template, with example values, to an address - the Test button. */
  async test(id, to) {
    const template = await EmailTemplate.findById(id).lean();
    if (!template) throw notFound("Template");
    return testSend({
      to,
      subject: template.subject,
      html: template.htmlBody,
      text: template.textBody,
      fromName: template.fromName,
    });
  },
};

/** A one-off send to one address with example placeholder values; shared by Compose and Templates. */
export async function testSend({ to, subject, html, text, fromName }) {
  requireMail();
  const appBrand = await brand();
  const message = buildMessage({ subject, html, text, fromName, appBrand, vars: sampleVars(to, appBrand) });
  const res = await send({ ...message, to });
  if (!res.ok) throw fail(res.error || "Failed to send test email", 502);
  return { ok: true, id: res.id };
}

/* ------------------------------------ lists ------------------------------------- */

/** Formula characters a spreadsheet would run if a cell started with one. */
const csvCell = (value) => {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export const lists = {
  /** Every list with its live count of active members, in two queries however many lists there are. */
  async list() {
    const [all, counts] = await Promise.all([
      EmailList.find().sort({ createdAt: -1 }).lean(),
      EmailListMember.aggregate([{ $match: { status: "active" } }, { $group: { _id: "$listId", n: { $sum: 1 } } }]),
    ]);
    const byList = new Map(counts.map((c) => [String(c._id), c.n]));
    return all.map((l) => ({ ...l, memberCount: byList.get(String(l._id)) ?? 0 }));
  },

  create: (data) => EmailList.create(data),

  async update(id, data) {
    const doc = await EmailList.findByIdAndUpdate(id, data, { new: true, runValidators: true }).lean();
    if (!doc) throw notFound("List");
    return doc;
  },

  /** Deleting a list takes its members with it. */
  async remove(id) {
    if (!(await EmailList.findByIdAndDelete(id))) throw notFound("List");
    await EmailListMember.deleteMany({ listId: id });
  },

  async members(id) {
    if (!(await EmailList.exists({ _id: id }))) throw notFound("List");
    return EmailListMember.find({ listId: id }).sort({ createdAt: -1 }).lean();
  },

  async addMember(id, { email, fullName }) {
    if (!(await EmailList.exists({ _id: id }))) throw notFound("List");

    // A registered user's own name wins over what the admin typed.
    const user = await User.findOne({ email }).select("name").lean();
    try {
      return await EmailListMember.create({
        listId: id,
        email,
        userId: user?._id,
        fullName: user?.name || fullName || "",
        status: "active",
        source: "manual",
      });
    } catch (err) {
      if (err.code === 11000) throw fail("This email is already in the list", 409);
      throw err;
    }
  },

  async removeMember(id, memberId) {
    const removed = await EmailListMember.findOneAndDelete({ _id: memberId, listId: id });
    if (!removed) throw notFound("Member");
  },

  /** The list as CSV text; the client turns it into a download. */
  async exportCsv(id) {
    const list = await EmailList.findById(id).lean();
    if (!list) throw notFound("List");
    const members = await EmailListMember.find({ listId: id }).sort({ createdAt: 1 }).lean();

    const rows = [
      ["Email", "Full Name", "Status", "Created Date"],
      ...members.map((m) => [m.email, m.fullName || "", m.status, m.createdAt.toISOString().slice(0, 10)]),
    ];
    return {
      filename: `${list.name.replace(/\s+/g, "_").replace(/[^\w.-]/g, "")}_${new Date().toISOString().slice(0, 10)}.csv`,
      csv: rows.map((r) => r.map(csvCell).join(",")).join("\n"),
    };
  },
};

/* ----------------------------------- audience ----------------------------------- */

export const audience = {
  /** Users the "select specific users" picker can search. */
  async searchUsers(q) {
    const filter = q
      ? { $or: [{ email: new RegExp(escapeRegex(q), "i") }, { name: new RegExp(escapeRegex(q), "i") }] }
      : {};
    const users = await User.find(filter).sort({ createdAt: -1 }).limit(50).select("email name workspaceId").lean();

    const subs = await Subscription.find({ workspaceId: { $in: users.map((u) => u.workspaceId).filter(Boolean) } })
      .select("workspaceId planId")
      .populate("planId", "name")
      .lean();
    const plans = new Map(subs.map((s) => [String(s.workspaceId), s.planId?.name]));

    return users.map((u) => ({
      id: String(u._id),
      email: u.email,
      name: u.name || "",
      planName: plans.get(String(u.workspaceId)) || "",
    }));
  },

  /** How many people the criteria reach right now. */
  async preview(criteria) {
    const recipients = await resolveAudience(criteria);
    return { count: recipients.length };
  },
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ------------------------------------- bulk -------------------------------------- */

/** Resolves the audience on the server, then sends one message per person. */
export async function sendBulk({ audience: criteria, subject, html, text, fromName }) {
  requireMail();
  const recipients = await resolveAudience(criteria);
  if (!recipients.length) throw fail("No recipients selected", 400);
  if (recipients.length > MAX_BULK_RECIPIENTS) {
    throw fail(`That audience has ${recipients.length} people; a single send is limited to ${MAX_BULK_RECIPIENTS}. Narrow it, or schedule it.`, 400);
  }
  return sendToRecipients({ recipients, subject, html, text, fromName });
}

/* ----------------------------------- scheduled ----------------------------------- */

export const scheduled = {
  /** Each pending email with how many people it would reach if it went out now. */
  async listWithCounts() {
    const all = await ScheduledEmail.find().sort({ scheduledDate: -1 }).lean();
    return Promise.all(
      all.map(async (email) =>
        email.status === "pending"
          ? { ...email, recipientCount: (await resolveAudience(email.audience)).length }
          : email,
      ),
    );
  },

  create: (data, adminId) => ScheduledEmail.create({ ...data, scheduledDate: new Date(data.scheduledDate), createdBy: adminId, status: "pending" }),

  /** Only a pending email can be cancelled; one that is already sending cannot be recalled. */
  async cancel(id) {
    const doc = await ScheduledEmail.findOneAndUpdate({ _id: id, status: "pending" }, { status: "cancelled" }, { new: true }).lean();
    if (!doc) throw fail("Only a pending email can be cancelled", 409);
    return doc;
  },

  async remove(id) {
    const removed = await ScheduledEmail.findOneAndDelete({ _id: id, status: { $ne: "sending" } });
    if (!removed) throw fail("That email is sending right now, or no longer exists", 409);
  },

  async runNow() {
    requireMail();
    return processDueScheduledEmails();
  },
};

/* ------------------------------------- stats ------------------------------------- */

export async function stats() {
  // The system templates are created on first look; count them after they exist.
  await ensureDefaultTemplates();
  const [emailLists, emailTemplates, scheduledPending, sent] = await Promise.all([
    EmailList.countDocuments(),
    EmailTemplate.countDocuments(),
    ScheduledEmail.countDocuments({ status: "pending" }),
    ScheduledEmail.countDocuments({ status: "sent" }),
  ]);
  return { emailLists, emailTemplates, scheduledPending, sentEmails: sent, mailConfigured: mailReady() };
}
