import { adjustCredits, getRates, planCredits } from "../billing/credit.service.js";
import {
  ApiKey,
  Avatar,
  AvatarAsset,
  Conversation,
  Invitation,
  KnowledgeDocument,
  McpServer,
  OAuthCode,
  OAuthToken,
  Persona,
  Plan,
  Subscription,
  TrainingJob,
  Transcript,
  User,
  Voice,
  Workspace,
} from "../../models/index.js";
import { isPlatformAdmin, isSuperAdmin } from "../../middleware/admin.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { sendEmail } from "../../integrations/mail/index.js";
import { getStorage } from "../../integrations/storage/registry.js";
import { authService } from "../auth/auth.service.js";
import { plansService } from "./plans.service.js";
import {
  assignPlanTo,
  blockUser,
  unblockUser,
  userFilter,
  userRowById,
  userRows,
} from "./admin.service.js";
import { planUpdateEmail } from "./admin.mail.js";
import { adminWorkspaceId, audit, endLiveCalls, fail, notFound } from "./admin.shared.js";

/**
 * Creating, editing, deleting and exporting accounts - the Users tab's writes.
 *
 * Every mutation is checked in full before anything is written, so a refused
 * save changes nothing, and each is recorded in an audit log.
 */

const EXPORT_BATCH = 500;
const CSV_COLUMNS = [
  "Name",
  "Email",
  "Plan",
  "Status",
  "Plan Credits",
  "Credits",
  "Source",
  "Organization",
  "Workspace",
  "Created Date",
];

/** An active, existing plan, or the reason it cannot be assigned. */
async function assignablePlan(planId) {
  const plan = await Plan.findById(planId).lean();
  if (!plan) throw fail(404, "Plan not found");
  if (!plan.active) throw fail(422, "That plan is archived and cannot be assigned.");
  return plan;
}

/** Admins other than this one, so the last one cannot be removed. */
const otherAdmins = (userId) =>
  User.countDocuments({
    _id: { $ne: userId },
    $or: [{ platformAdmin: true }, { email: { $in: env.adminEmails } }],
  });

/**
 * A cell safe to open in a spreadsheet. One that starts with = + - or @ is read
 * as a formula by Excel and Sheets, so an account named `=HYPERLINK(...)` could
 * run on whoever opens the export; a leading apostrophe makes it plain text.
 */
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const isoDay = (value) => new Date(value).toISOString().slice(0, 10);

export const usersService = {
  /**
   * Creates an account exactly as sign-up does (user, workspace, subscription
   * on the default plan), then applies what the admin chose.
   */
  async create(fields, { admin, ip }) {
    const email = fields.email.toLowerCase();
    if (await User.exists({ email })) throw fail(409, "A user with this email already exists.");

    const role = fields.role || "user";
    const status = fields.status || "active";
    if (role === "admin" && status === "suspended") {
      throw fail(422, "An admin cannot be created suspended.");
    }
    const plan = fields.planId ? await assignablePlan(fields.planId) : null;

    const { user } = await authService.register({ email, password: fields.password, name: fields.name });

    await User.updateOne(
      { _id: user.id },
      {
        $set: {
          source: "manual",
          organization: fields.organization || undefined,
          platformAdmin: role === "admin",
          ...(status === "suspended" && { blockedAt: new Date(), blockedBy: admin._id }),
        },
      },
    );
    if (plan) await plansService.assign({ workspaceId: user.workspaceId, plan, assignedBy: admin._id });
    if (fields.startingCredits) {
      await adjustCredits({
        workspaceId: user.workspaceId,
        credits: fields.startingCredits,
        note: "Starting credits from an admin",
        actorId: admin._id,
      });
    }

    await audit({
      workspaceId: user.workspaceId,
      admin,
      action: "admin.user.create",
      target: { kind: "user", id: user.id },
      meta: { role, status, plan: plan?.key || null, startingCredits: fields.startingCredits || 0 },
      ip,
    });
    logger.info({ userId: user.id, by: String(admin._id) }, "user created by admin");
    return { user: await userRowById(user.id) };
  },

  /**
   * Applies an Edit User save: profile, role, plan, and status.
   * Status goes last because suspending signs the person out and ends their
   * calls - not something to do before the rest has been accepted.
   *
   * `planEmail` says what happened to the "your plan changed" email:
   * "sent", "failed", or "skipped" (no plan change, or mail is not set up).
   */
  async update(id, fields, { admin, ip }) {
    const user = await User.findById(id)
      .select("email name organization platformAdmin blockedAt workspaceId")
      .lean();
    if (!user) throw notFound();

    const wasAdmin = isPlatformAdmin(user);
    const becomesAdmin = fields.role === undefined ? wasAdmin : fields.role === "admin";
    const suspended = fields.status === undefined ? Boolean(user.blockedAt) : fields.status === "suspended";
    const self = String(user._id) === String(admin._id);

    // Everything that can refuse, before anything is written.
    if (wasAdmin && !becomesAdmin) {
      if (isSuperAdmin(user.email)) {
        throw fail(422, "This admin is listed in ADMIN_EMAILS, which cannot be changed from here.");
      }
      if (self) throw fail(422, "You cannot remove your own admin access.");
      if ((await otherAdmins(user._id)) === 0) throw fail(422, "There must always be at least one admin.");
    }
    if (becomesAdmin && suspended) throw fail(422, "Admins cannot be suspended. Demote them first.");
    if (suspended && !user.blockedAt && self) throw fail(422, "You cannot suspend yourself.");

    const subscription = user.workspaceId
      ? await Subscription.findOne({ workspaceId: user.workspaceId }).select("planId").lean()
      : null;
    const changesPlan = fields.planId !== undefined && String(subscription?.planId || "") !== fields.planId;
    const plan = changesPlan ? await assignablePlan(fields.planId) : null;
    if (changesPlan && !user.workspaceId) {
      throw fail(422, "This user has no workspace to put on a plan.");
    }

    const changes = {};
    const profile = {};
    for (const key of ["name", "organization"]) {
      if (fields[key] !== undefined && fields[key] !== (user[key] || "")) {
        profile[key] = fields[key];
        changes[key] = { from: user[key] || null, to: fields[key] || null };
      }
    }
    if (becomesAdmin !== wasAdmin) {
      profile.platformAdmin = becomesAdmin;
      changes.role = { from: wasAdmin ? "admin" : "user", to: becomesAdmin ? "admin" : "user" };
    }
    if (Object.keys(profile).length) await User.updateOne({ _id: user._id }, { $set: profile });

    if (plan) await assignPlanTo(id, fields.planId, { admin, ip });

    if (suspended && !user.blockedAt) {
      await blockUser(id, { reason: fields.blockReason }, { admin, ip });
      changes.status = { from: "active", to: "suspended" };
    } else if (!suspended && user.blockedAt) {
      await unblockUser(id, { admin, ip });
      changes.status = { from: "suspended", to: "active" };
    }

    if (Object.keys(changes).length) {
      await audit({
        workspaceId: user.workspaceId,
        admin,
        action: "admin.user.update",
        target: { kind: "user", id: String(user._id) },
        meta: changes,
        ip,
      });
    }

    const row = await userRowById(id);
    return {
      user: row,
      planEmail: plan ? await sendPlanUpdate(user, plan) : "skipped",
    };
  },

  /**
   * Deletes an account for good. When they are the only person in their
   * workspace, the workspace goes with them; see `wipeWorkspace` for what that
   * keeps and why.
   *
   * Refused for yourself and for any admin, and for a workspace owner whose
   * workspace other people still use - deleting that would pull it out from
   * under them.
   */
  async remove(id, { admin, ip }) {
    const user = await User.findById(id).select("email platformAdmin workspaceId").lean();
    if (!user) throw notFound();
    if (String(user._id) === String(admin._id)) throw fail(422, "You cannot delete your own account.");
    if (isPlatformAdmin(user)) throw fail(422, "Admins cannot be deleted. Demote them first.");

    const workspace = user.workspaceId ? await Workspace.findById(user.workspaceId).lean() : null;
    const owner = Boolean(workspace) && String(workspace.ownerId) === String(user._id);
    const others = workspace ? await User.countDocuments({ workspaceId: workspace._id, _id: { $ne: user._id } }) : 0;
    if (owner && others > 0) {
      throw fail(
        409,
        `This user owns a workspace that ${others} other ${others === 1 ? "person uses" : "people use"}. Remove them from it first.`,
      );
    }

    // Calls first: nothing should be billing against an account being erased.
    const endedCalls = await endLiveCalls(user, "account deleted");

    let removed = null;
    if (owner) removed = await wipeWorkspace(workspace);

    // The person's own credentials and grants, whether or not the workspace goes.
    await Promise.all([
      ApiKey.deleteMany({ userId: user._id }),
      OAuthCode.deleteMany({ userId: user._id }),
      OAuthToken.deleteMany({ userId: user._id }),
      // Invitations they sent, and ones sent to their address.
      Invitation.deleteMany({ $or: [{ invitedBy: user._id }, { email: user.email }] }),
    ]);
    await User.deleteOne({ _id: user._id });

    // The account's own audit log is not wiped (it is the trail of what admins
    // did to it), so this entry goes in the deleting admin's workspace too.
    await audit({
      workspaceId: await adminWorkspaceId(admin),
      admin,
      action: "admin.user.delete",
      target: { kind: "user", id: String(user._id) },
      meta: { email: user.email, workspaceDeleted: Boolean(removed), endedCalls, ...removed },
      ip,
    });
    logger.info({ userId: String(user._id), by: String(admin._id), ...removed }, "user deleted by admin");
    return { id: String(user._id), workspaceDeleted: Boolean(removed), ...removed };
  },

  /** Every user matching the filters as CSV text - all pages, not just the one on screen. */
  async exportCsv(filters) {
    const filter = await userFilter(filters);
    const lines = [CSV_COLUMNS.map(csvCell).join(",")];

    // A cursor in batches, so a large user base never sits in memory at once.
    const cursor = User.find(filter)
      .sort({ createdAt: -1 })
      .select("email name organization source platformAdmin workspaceId createdAt blockedAt")
      .lean()
      .cursor({ batchSize: EXPORT_BATCH });

    let batch = [];
    const flush = async () => {
      for (const u of await userRows(batch)) {
        lines.push(
          [
            u.name || "N/A",
            u.email,
            u.plan || "No Plan",
            u.status,
            u.unlimited ? "unlimited" : u.planCredits,
            u.unlimited ? "unlimited" : u.credits,
            u.source,
            u.organization || "N/A",
            u.workspace?.name || "N/A",
            isoDay(u.createdAt),
          ]
            .map(csvCell)
            .join(","),
        );
      }
      batch = [];
    };
    for await (const user of cursor) {
      batch.push(user);
      if (batch.length >= EXPORT_BATCH) await flush();
    }
    if (batch.length) await flush();

    return lines.join("\r\n");
  },
};

/** Tells the user their plan changed. Mail being unconfigured is not an error worth showing. */
async function sendPlanUpdate(user, plan) {
  const fresh = await User.findById(user._id).select("name email").lean();
  const message = planUpdateEmail({
    name: fresh?.name,
    planName: plan.name,
    planCredits: planCredits(plan, await getRates()),
    unlimited: Boolean(plan.unlimitedCredits),
  });
  const result = await sendEmail({ to: user.email, ...message });
  if (result.ok) return "sent";
  return result.error === "Email is not configured" ? "skipped" : "failed";
}

/**
 * Removes a workspace and what is inside it: avatars with their training jobs,
 * knowledge, MCP servers, personas, voices, uploaded files, and the subscription.
 *
 * Deliberately kept, for billing and audit: the usage ledger, the workspace's
 * audit log, and conversation records - minus anything personal. Transcripts
 * (what people said) are deleted, and a conversation loses its guest's name and
 * email, the meeting address and the user link, leaving only when it happened,
 * how long it ran and what it cost. Share links need no step of their own:
 * they live on the avatars and die with them.
 */
async function wipeWorkspace(workspace) {
  const workspaceId = workspace._id;
  const avatarIds = (await Avatar.find({ workspaceId }).select("_id").lean()).map((a) => a._id);
  const assets = await AvatarAsset.find({ workspaceId }).select("storageKey").lean();

  // Files first: if storage is down the database still shows what is left to clean.
  const storage = getStorage();
  await Promise.all(
    assets.map((a) =>
      storage.remove(a.storageKey).catch((err) => logger.warn({ err: err.message, key: a.storageKey }, "could not remove file")),
    ),
  );

  await Promise.all([
    TrainingJob.deleteMany({ avatarId: { $in: avatarIds } }),
    KnowledgeDocument.deleteMany({ workspaceId }),
    McpServer.deleteMany({ workspaceId }),
    Persona.deleteMany({ workspaceId }),
    Voice.deleteMany({ workspaceId, isStock: { $ne: true } }),
    AvatarAsset.deleteMany({ workspaceId }),
    ApiKey.deleteMany({ workspaceId }),
    OAuthCode.deleteMany({ workspaceId }),
    OAuthToken.deleteMany({ workspaceId }),
    Transcript.deleteMany({ workspaceId }),
    Conversation.updateMany(
      { workspaceId },
      { $unset: { guest: "", meetingUrl: "", userId: "", providerSessionId: "" } },
    ),
  ]);
  await Avatar.deleteMany({ workspaceId });
  await Subscription.deleteOne({ workspaceId });
  await Workspace.deleteOne({ _id: workspaceId });

  return { avatars: avatarIds.length, files: assets.length };
}
