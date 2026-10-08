import bcrypt from "bcryptjs";
import { AuditLog, User } from "../../models/index.js";

const ROUNDS = 12;
const MIN_PASSWORD = 10;

const fail = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, ...(code && { code }) });

/**
 * The people in a workspace, and who may add, change or remove whom.
 *
 *   owner   - made the workspace. Cannot be changed or removed by anyone here.
 *   admin   - runs the team. Adds and manages members only.
 *   member  - uses the avatars. Cannot see or change the team.
 *
 * Everyone in a workspace shares its avatars, plan and credits. Someone who is
 * removed is deleted: the account only ever existed inside this workspace.
 */
const ASSIGNABLE = { owner: ["admin", "member"], admin: ["member"] };
const canAssign = (actor, role) => (ASSIGNABLE[actor.role] || []).includes(role);

/** May `actor` change or remove `target`? Never themselves (that is the profile page) and never the owner. */
function assertCanManage(actor, target) {
  if (String(actor._id) === String(target._id)) throw fail(422, "You cannot change your own access here. Use your profile.");
  if (target.role === "owner") throw fail(403, "The workspace owner cannot be changed or removed.");
  if (actor.role === "admin" && target.role !== "member") throw fail(403, "Admins can only manage members.");
}

export const present = (u) => ({
  id: String(u._id),
  name: u.name || "",
  email: u.email,
  role: u.role,
  title: u.title || "",
  photoUrl: u.photoUrl || null,
  lastLoginAt: u.lastLoginAt || null,
  createdAt: u.createdAt,
  suspended: Boolean(u.blockedAt),
});

async function find(workspaceId, id) {
  const user = /^[0-9a-f]{24}$/i.test(id) ? await User.findOne({ _id: id, workspaceId }) : null;
  if (!user) throw fail(404, "That person is not in this workspace.");
  return user;
}

const log = (req, action, target, meta) =>
  AuditLog.create({
    workspaceId: req.workspace._id,
    actorId: req.actor._id,
    action,
    target: { kind: "user", id: String(target._id) },
    meta,
    ip: req.ip,
  }).catch(() => {});

export const teamService = {
  async list(workspace) {
    const users = await User.find({ workspaceId: workspace._id }).lean();
    const order = { owner: 0, admin: 1, member: 2 };
    users.sort((a, b) => order[a.role] - order[b.role] || String(a.name || a.email).localeCompare(String(b.name || b.email)));
    return users.map(present);
  },

  /** A real account that can sign in at once with the password set here. */
  async create(req, { name, email, password, role }) {
    if (!canAssign(req.actor, role)) throw fail(403, role === "admin" ? "Only the owner can add admins." : "That role cannot be given.");
    if (password.length < MIN_PASSWORD) throw fail(422, `Use at least ${MIN_PASSWORD} characters for the password.`);

    const taken = await User.exists({ email: email.toLowerCase() });
    if (taken) throw fail(409, "Someone with that email already has an account.");

    const user = await User.create({
      email,
      name,
      passwordHash: await bcrypt.hash(password, ROUNDS),
      workspaceId: req.workspace._id,
      role,
      source: "manual",
      createdBy: req.actor._id,
    });
    await log(req, "team.member_added", user, { role });
    return present(user);
  },

  async update(req, id, { name, role, title }) {
    const user = await find(req.workspace._id, id);
    assertCanManage(req.actor, user);

    if (role !== undefined && role !== user.role) {
      if (!canAssign(req.actor, role)) throw fail(403, "Only the owner can make someone an admin.");
      user.role = role;
      // Their sessions carry the old role; the fresh one is read on every request, but end old tokens too.
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }
    if (name !== undefined) user.name = name;
    if (title !== undefined) user.title = title;
    await user.save();
    await log(req, "team.member_updated", user, { role, name: name !== undefined });
    return present(user);
  },

  /** Signs them out everywhere, so the new password is the only way back in. */
  async resetPassword(req, id, password) {
    if (password.length < MIN_PASSWORD) throw fail(422, `Use at least ${MIN_PASSWORD} characters for the password.`);
    const user = await find(req.workspace._id, id);
    assertCanManage(req.actor, user);
    user.passwordHash = await bcrypt.hash(password, ROUNDS);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    await log(req, "team.password_reset", user);
    return { ok: true };
  },

  async remove(req, id) {
    const user = await find(req.workspace._id, id);
    assertCanManage(req.actor, user);
    await User.deleteOne({ _id: user._id });
    await log(req, "team.member_removed", user, { email: user.email });
    return { id: String(user._id) };
  },
};
