import crypto from "node:crypto";
import { Invitation, Plan, User } from "../../models/index.js";
import { sendEmail } from "../../integrations/mail/index.js";
import { accountBlocked } from "../auth/blocked.js";
import { plansService } from "../admin/plans.service.js";
import { adminWorkspaceId, audit, fail } from "../admin/admin.shared.js";
import { webOrigin } from "../admin/admin.mail.js";
import { invitationEmail } from "./invitation.mail.js";

/**
 * Invitations: an admin invites an email address onto a plan, the person opens
 * the link, signs in with that address, and accepts.
 *
 * The link carries a random token; only its SHA-256 is stored, so a leaked
 * database cannot be turned into working links. The link is shown to the admin
 * once, when the invitation is made.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 20;

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

/** Past its expiry a pending invitation is expired, whether or not anything has marked it yet. */
const effectiveStatus = (inv) =>
  inv.status === "pending" && new Date(inv.expiresAt) <= new Date() ? "expired" : inv.status;

const invalidLink = () => fail(404, "This invitation link is not valid.");
const expiredLink = () => fail(410, "This invitation has expired. Please ask for a new one.");

async function findByToken(token) {
  const invitation = await Invitation.findOne({ tokenHash: hashToken(token) });
  if (!invitation) throw invalidLink();
  return invitation;
}

/** Marks an overdue pending invitation expired, so the record matches what people see. */
async function expireIfOverdue(invitation) {
  if (invitation.status === "pending" && invitation.expiresAt <= new Date()) {
    invitation.status = "expired";
    await invitation.save();
  }
}

const publicRow = (inv) => ({
  id: inv._id,
  email: inv.email,
  role: inv.role,
  status: effectiveStatus(inv),
  plan: inv.planId ? { id: inv.planId._id, name: inv.planId.name } : null,
  message: inv.message || null,
  expiresAt: inv.expiresAt,
  createdAt: inv.createdAt,
  emailSent: inv.emailSent,
  invitedBy: inv.invitedBy?.email || null,
});

export const invitationService = {
  /**
   * Makes an invitation and emails it. When mail is not set up, or the send
   * fails, the invitation still exists and `emailSent` is false - the admin
   * copies the link and shares it themselves.
   */
  async create({ email, role, planId, message }, { admin, ip }) {
    const plan = await Plan.findById(planId).lean();
    if (!plan) throw fail(404, "Plan not found");
    if (!plan.active) throw fail(422, "That plan is archived and cannot be assigned.");

    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + WEEK_MS);
    const invitation = await Invitation.create({
      email,
      role,
      planId: plan._id,
      message: message || undefined,
      tokenHash: hashToken(token),
      invitedBy: admin._id,
      expiresAt,
    });

    const link = `${webOrigin()}/invite/${token}`;
    const sent = await sendEmail({
      to: email,
      ...invitationEmail({ link, planName: plan.name, role, expiresAt, message }),
    });
    if (sent.ok) await Invitation.updateOne({ _id: invitation._id }, { $set: { emailSent: true } });

    await audit({
      workspaceId: await adminWorkspaceId(admin),
      admin,
      action: "admin.invitation.create",
      target: { kind: "invitation", id: String(invitation._id) },
      meta: { email, role, plan: plan.key, emailSent: sent.ok },
      ip,
    });

    return {
      invitation: {
        id: invitation._id,
        email,
        role,
        status: "pending",
        plan: { id: plan._id, name: plan.name },
        message: message || null,
        expiresAt,
        createdAt: invitation.createdAt,
        emailSent: sent.ok,
        invitedBy: null,
      },
      link,
      emailSent: sent.ok,
      emailError: sent.ok ? null : sent.error,
    };
  },

  /** The most recent invitations, newest first. */
  async list({ status } = {}) {
    const now = new Date();
    // "expired" includes pending ones past their date, which are not marked yet.
    const filter =
      status === "expired"
        ? { $or: [{ status: "expired" }, { status: "pending", expiresAt: { $lte: now } }] }
        : status === "pending"
          ? { status: "pending", expiresAt: { $gt: now } }
          : status
            ? { status }
            : {};

    const rows = await Invitation.find(filter)
      .sort({ createdAt: -1 })
      .limit(RECENT_LIMIT)
      .populate("planId", "name")
      .populate("invitedBy", "email")
      .lean();
    return { invitations: rows.map(publicRow) };
  },

  /** Cancels a pending invitation: its link stops working at once. */
  async revoke(id, { admin, ip }) {
    const invitation = await Invitation.findById(id);
    if (!invitation) throw fail(404, "Invitation not found");
    if (invitation.status === "accepted") throw fail(409, "This invitation was already accepted.");

    invitation.status = "expired";
    invitation.expiresAt = new Date();
    await invitation.save();

    await audit({
      workspaceId: await adminWorkspaceId(admin),
      admin,
      action: "admin.invitation.revoke",
      target: { kind: "invitation", id: String(invitation._id) },
      meta: { email: invitation.email },
      ip,
    });
    return { id: String(invitation._id) };
  },

  /**
   * What the invitation page shows. Open to anyone holding the link, which is
   * the credential; the address is returned so the page can say which account
   * to sign in with.
   */
  async describe(token) {
    const invitation = await findByToken(token);
    await expireIfOverdue(invitation);
    if (invitation.status === "expired") throw expiredLink();

    const plan = invitation.planId ? await Plan.findById(invitation.planId).lean() : null;
    return {
      invitation: {
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        message: invitation.message || null,
        plan: plan && { name: plan.name, description: plan.description || null, includedMinutes: plan.includedMinutes ?? 0 },
      },
    };
  },

  /**
   * Accepts for the signed-in user: puts their workspace on the invited plan
   * and, for an admin invitation, makes them an admin (never the reverse).
   *
   * The invitation is claimed first with a single conditional update, so two
   * clicks at once cannot both apply it; if applying then fails, the claim is
   * released so the link still works.
   */
  async accept(token, { userId }) {
    const invitation = await findByToken(token);

    if (invitation.status === "accepted") {
      return { success: true, alreadyAccepted: true, message: "This invitation was already used." };
    }
    await expireIfOverdue(invitation);
    if (invitation.status === "expired") throw expiredLink();

    const user = await User.findById(userId).select("email name source platformAdmin blockedAt workspaceId createdAt").lean();
    if (!user) throw fail(401, "Authentication required");
    if (user.blockedAt) throw accountBlocked();
    if (invitation.email !== user.email.toLowerCase().trim()) {
      throw fail(403, `This invitation was sent to ${invitation.email}. Please sign in with that email address.`);
    }
    if (!user.workspaceId) throw fail(422, "This account has no workspace to put on a plan.");

    const plan = invitation.planId ? await Plan.findById(invitation.planId).lean() : null;
    if (!plan) throw fail(410, "The plan for this invitation no longer exists. Please ask for a new one.");
    if (!plan.active) throw fail(410, "The plan for this invitation is no longer available. Please ask for a new one.");

    const claimed = await Invitation.findOneAndUpdate(
      { _id: invitation._id, status: "pending" },
      { $set: { status: "accepted", acceptedAt: new Date(), acceptedBy: user._id } },
    );
    if (!claimed) return { success: true, alreadyAccepted: true, message: "This invitation was already used." };

    try {
      await plansService.assign({ workspaceId: user.workspaceId, plan, assignedBy: invitation.invitedBy });

      const patch = {};
      if (invitation.role === "admin" && !user.platformAdmin) patch.platformAdmin = true;
      // Someone who signed up after being invited came in by invitation; an
      // established account that is merely handed a plan keeps its source.
      if ((user.source || "signup") === "signup" && user.createdAt > invitation.createdAt) patch.source = "invited";
      if (Object.keys(patch).length) await User.updateOne({ _id: user._id }, { $set: patch });
    } catch (err) {
      await Invitation.updateOne(
        { _id: invitation._id },
        { $set: { status: "pending" }, $unset: { acceptedAt: "", acceptedBy: "" } },
      );
      throw err;
    }

    return {
      success: true,
      planName: plan.name,
      role: invitation.role === "admin" || user.platformAdmin ? "admin" : "user",
    };
  },
};
