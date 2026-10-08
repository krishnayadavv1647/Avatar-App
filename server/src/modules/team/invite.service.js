import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { AuditLog, TeamInvite, User, Workspace } from "../../models/index.js";
import { issueTokens, publicUser } from "../auth/auth.service.js";
import { webOrigin } from "../admin/admin.mail.js";

const ROUNDS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
export const EXPIRY_DAYS = [1, 7, 30];
export const MAX_USES = 50;
const MAX_ACTIVE_PER_WORKSPACE = 25;

const fail = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, ...(code && { code }) });

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

// Same rule as the roles on the Team page: the owner makes admin or member links, an admin only member links.
const ASSIGNABLE = { owner: ["admin", "member"], admin: ["member"] };

/** Why a link cannot be used, or null when it can. Expiry is judged by the clock, not by anything having marked it. */
const unusable = (invite) => {
  if (invite.status === "revoked") return "revoked";
  if (invite.expiresAt <= new Date()) return "expired";
  if (invite.uses >= invite.maxUses) return "used";
  return null;
};

const MESSAGES = {
  revoked: "This invite link was cancelled. Ask for a new one.",
  expired: "This invite link has expired. Ask for a new one.",
  used: "This invite link has already been used. Ask for a new one.",
};

async function findByToken(token) {
  const invite = await TeamInvite.findOne({ tokenHash: hashToken(token) });
  // One message for "never existed", so a stranger cannot tell which links were ever real.
  if (!invite) throw fail(404, "This invite link is not valid.");
  return invite;
}

const row = (inv) => ({
  id: String(inv._id),
  role: inv.role,
  email: inv.email || null,
  uses: inv.uses,
  maxUses: inv.maxUses,
  expiresAt: inv.expiresAt,
  createdAt: inv.createdAt,
  createdBy: inv.createdBy?.name || inv.createdBy?.email || null,
});

const log = (req, action, target, meta) =>
  AuditLog.create({
    workspaceId: req.workspace._id,
    actorId: req.actor._id,
    action,
    target: { kind: "invite", id: String(target._id) },
    meta,
    ip: req.ip,
  }).catch(() => {});

export const inviteService = {
  /** Makes a link. The token is in the answer once and nowhere else. */
  async create(req, { role, expiresInDays, maxUses, email }) {
    if (!(ASSIGNABLE[req.actor.role] || []).includes(role)) {
      throw fail(403, role === "admin" ? "Only the owner can invite admins." : "That role cannot be given.");
    }
    const active = await TeamInvite.countDocuments({ workspaceId: req.workspace._id, status: "active", expiresAt: { $gt: new Date() } });
    if (active >= MAX_ACTIVE_PER_WORKSPACE) {
      throw fail(422, `There are already ${MAX_ACTIVE_PER_WORKSPACE} open invite links. Cancel some first.`);
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const invite = await TeamInvite.create({
      workspaceId: req.workspace._id,
      tokenHash: hashToken(token),
      role,
      ...(email && { email }),
      createdBy: req.actor._id,
      // A link for one named address is for one person.
      maxUses: email ? 1 : maxUses,
      expiresAt: new Date(Date.now() + expiresInDays * DAY_MS),
    });
    await log(req, "team.invite_created", invite, { role, maxUses: invite.maxUses, email: email || null });
    return { invite: row(invite), link: `${webOrigin()}/join/${token}` };
  },

  /** Links that still work, newest first. They never carry the token. */
  async list(workspace) {
    const rows = await TeamInvite.find({ workspaceId: workspace._id, status: "active", expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .populate("createdBy", "name email")
      .lean();
    return rows.filter((inv) => inv.uses < inv.maxUses).map(row);
  },

  async revoke(req, id) {
    const invite = /^[0-9a-f]{24}$/i.test(id) ? await TeamInvite.findOne({ _id: id, workspaceId: req.workspace._id }) : null;
    if (!invite) throw fail(404, "That invite link was not found.");
    // An admin cancels the links they made; the owner cancels any.
    if (req.actor.role !== "owner" && String(invite.createdBy) !== String(req.actor._id)) {
      throw fail(403, "You can only cancel links you made.");
    }
    invite.status = "revoked";
    await invite.save();
    await log(req, "team.invite_revoked", invite);
    return { id: String(invite._id) };
  },

  /** What the page shows before anyone has an account: where they would join, and as what. */
  async describe(token) {
    const invite = await findByToken(token);
    const reason = unusable(invite);
    if (reason) throw fail(410, MESSAGES[reason], `invite_${reason}`);

    const [workspace, inviter] = await Promise.all([
      Workspace.findById(invite.workspaceId).select("name").lean(),
      User.findById(invite.createdBy).select("name email").lean(),
    ]);
    if (!workspace) throw fail(410, MESSAGES.revoked, "invite_revoked");
    return {
      workspace: workspace.name,
      role: invite.role,
      invitedBy: inviter?.name || inviter?.email || null,
      // The address it is locked to, when it is: the page pre-fills it and the server checks it.
      email: invite.email || null,
      expiresAt: invite.expiresAt,
    };
  },

  /**
   * Makes the account inside the workspace and signs it in. A new account only:
   * a person belongs to exactly one workspace, so an existing account is never
   * moved out of its own - that would strand its avatars and credits.
   */
  async join(token, { name, email, password }) {
    const invite = await findByToken(token);
    const reason = unusable(invite);
    if (reason) throw fail(410, MESSAGES[reason], `invite_${reason}`);
    if (invite.email && invite.email !== email.toLowerCase()) {
      throw fail(403, "This invite link is for a different email address.");
    }
    if (await User.exists({ email: email.toLowerCase() })) {
      throw fail(409, "Someone with that email already has an account. Use a different email, or ask the owner to add you.");
    }

    // Claim a use first, atomically, so two people opening a single-use link at
    // once cannot both get in. Given back below if the account cannot be made.
    const claimed = await TeamInvite.findOneAndUpdate(
      {
        _id: invite._id,
        status: "active",
        expiresAt: { $gt: new Date() },
        $expr: { $lt: ["$uses", "$maxUses"] },
      },
      { $inc: { uses: 1 } },
      { new: true },
    );
    if (!claimed) throw fail(410, MESSAGES.used, "invite_used");

    let user;
    try {
      user = await User.create({
        email,
        name,
        passwordHash: await bcrypt.hash(password, ROUNDS),
        workspaceId: invite.workspaceId,
        role: invite.role,
        source: "invited",
        createdBy: invite.createdBy,
        lastLoginAt: new Date(),
      });
    } catch (err) {
      await TeamInvite.updateOne({ _id: invite._id }, { $inc: { uses: -1 } });
      if (err.code === 11000) throw fail(409, "Someone with that email already has an account.");
      throw err;
    }

    await TeamInvite.updateOne({ _id: invite._id }, { $push: { usedBy: user._id } });
    await AuditLog.create({
      workspaceId: invite.workspaceId,
      actorId: user._id,
      action: "team.invite_used",
      target: { kind: "invite", id: String(invite._id) },
      meta: { role: invite.role },
    }).catch(() => {});

    return { user: publicUser(user), ...issueTokens(user) };
  },
};
