import {
  Avatar,
  Invitation,
  Conversation,
  CreditAccount,
  KnowledgeDocument,
  Plan,
  Subscription,
  UsageLedger,
  User,
  Workspace,
} from "../../models/index.js";
import { isPlatformAdmin, isSuperAdmin } from "../../middleware/admin.js";
import { authService } from "../auth/auth.service.js";
import { usageService } from "../billing/usage.service.js";
import { creditService, getRates, planCredits, round2 } from "../billing/credit.service.js";
import { plansService } from "./plans.service.js";
import { audit, endLiveCalls, fail, notFound } from "./admin.shared.js";
import { logger } from "../../config/logger.js";

/**
 * What a platform admin sees: every user, across every workspace.
 *
 * Mostly read-only. The few actions that change an account - blocking and
 * assigning a plan - are each written to the target workspace's audit log.
 *
 * Avatars, calls and minutes belong to a workspace, not a person, so a user's
 * figures are their workspace's. Nearly every workspace has one user.
 */

const DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 30;
const CHART_DAYS = 14;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A timezone MongoDB and Intl both accept, or UTC. */
function safeZone(tz) {
  try {
    if (tz) {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    }
  } catch {
    // Unknown zone: fall through.
  }
  return "UTC";
}

/** The last `days` calendar dates in `tz`, oldest first, as YYYY-MM-DD. */
function lastDays(days, tz, now = Date.now()) {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  return Array.from({ length: days }, (_, i) => format.format(new Date(now - (days - 1 - i) * DAY)));
}

const minutes = (seconds) => Math.round((seconds / 60) * 10) / 10;

export const adminService = {
  /** Total users, users not blocked, invitations still open, and every minute of calls ever made. */
  async stats() {
    const [totalUsers, blocked, pendingInvites, minutes] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ blockedAt: { $ne: null } }),
      Invitation.countDocuments({ status: "pending", expiresAt: { $gt: new Date() } }),
      UsageLedger.aggregate([{ $group: { _id: null, minutes: { $sum: "$minutes" } } }]),
    ]);
    return {
      totalUsers,
      activeUsers: totalUsers - blocked,
      pendingInvites,
      totalMinutes: Math.round((minutes[0]?.minutes || 0) * 10) / 10,
    };
  },

  async overview({ tz }) {
    const zone = safeZone(tz);
    const now = Date.now();
    const since1d = new Date(now - DAY);
    const since7d = new Date(now - 7 * DAY);
    // A day of slack: the oldest chart day starts at midnight in `zone`, which
    // can be up to a day before now - 14 days.
    const sinceChart = new Date(now - (CHART_DAYS + 1) * DAY);

    const [
      totalUsers,
      blockedUsers,
      newUsers7d,
      totalAvatars,
      totalCalls,
      calls24h,
      calls7d,
      totals,
      totals7d,
      busyWorkspaces,
      daily,
      live,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ blockedAt: { $ne: null } }),
      User.countDocuments({ createdAt: { $gte: since7d } }),
      Avatar.countDocuments(),
      Conversation.countDocuments(),
      Conversation.countDocuments({ createdAt: { $gte: since1d } }),
      Conversation.countDocuments({ createdAt: { $gte: since7d } }),
      sumCalls({}),
      sumCalls({ createdAt: { $gte: since7d } }),
      Conversation.distinct("workspaceId", { createdAt: { $gte: since7d } }),
      Conversation.aggregate([
        { $match: { createdAt: { $gte: sinceChart } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: zone } },
            calls: { $sum: 1 },
            seconds: { $sum: "$durationSec" },
          },
        },
      ]),
      Conversation.find({ status: "active" })
        .sort({ startedAt: -1 })
        .limit(20)
        .populate("avatarId", "name")
        .select("avatarId workspaceId userId source guest startedAt createdAt")
        .lean(),
    ]);

    // Active: signed in, or made a call, in the last seven days.
    const activeUsers7d = await User.countDocuments({
      $or: [{ lastLoginAt: { $gte: since7d } }, { workspaceId: { $in: busyWorkspaces } }],
    });

    const byDay = new Map(daily.map((d) => [d._id, d]));
    const owners = await usersById(live.map((c) => c.userId));

    return {
      timezone: zone,
      users: { total: totalUsers, new7d: newUsers7d, active7d: activeUsers7d, blocked: blockedUsers },
      avatars: { total: totalAvatars },
      calls: {
        total: totalCalls,
        last24h: calls24h,
        last7d: calls7d,
        live: live.length,
      },
      minutes: { total: minutes(totals.seconds), last7d: minutes(totals7d.seconds) },
      costCents: { total: totals.costCents, last7d: totals7d.costCents },
      daily: lastDays(CHART_DAYS, zone, now).map((date) => ({
        date,
        calls: byDay.get(date)?.calls || 0,
        minutes: minutes(byDay.get(date)?.seconds || 0),
      })),
      liveCalls: live.map((c) => ({
        id: c._id,
        avatar: c.avatarId?.name || "Deleted avatar",
        user: owners.get(String(c.userId)) || null,
        source: c.source,
        guest: c.guest?.name || null,
        startedAt: c.startedAt || c.createdAt,
      })),
    };
  },

  /**
   * One page of users matching the filters, with what each row shows. Search,
   * filters and paging all happen here, so the screen never holds more than a
   * page and the CSV export can reuse the exact same filter.
   */
  async listUsers({ page = 1, ...filters }) {
    const filter = await userFilter(filters);

    const [total, activeTotal, users] = await Promise.all([
      User.countDocuments(filter),
      User.countDocuments({ blockedAt: null }),
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .select(USER_ROW_FIELDS)
        .lean(),
    ]);

    return { total, activeTotal, page, pageSize: PAGE_SIZE, users: await userRows(users) };
  },

  async getUser(id) {
    const user = await User.findById(id)
      .select(
        "email name role platformAdmin organization source workspaceId createdAt lastLoginAt blockedAt blockedReason blockedBy",
      )
      .populate("blockedBy", "email")
      .lean();
    if (!user) throw notFound();

    const workspaceId = user.workspaceId;
    const [workspace, subscription, avatars, conversations, totals, totals7d, documents] =
      await Promise.all([
        Workspace.findById(workspaceId).select("name createdAt settings").lean(),
        Subscription.findOne({ workspaceId })
          .select("plan planId status assignedAt")
          .populate("planId", "name key")
          .lean(),
        Avatar.find({ workspaceId })
          .sort({ createdAt: -1 })
          .select("name previewUrl status providerId sourceType createdAt updatedAt")
          .lean(),
        Conversation.find({ workspaceId })
          .sort({ createdAt: -1 })
          .limit(50)
          .populate("avatarId", "name")
          .select("avatarId source guest status startedAt endedAt durationSec costCents endReason createdAt")
          .lean(),
        sumCalls({ workspaceId }),
        sumCalls({ workspaceId, createdAt: { $gte: new Date(Date.now() - 7 * DAY) } }),
        KnowledgeDocument.countDocuments({ workspaceId }),
      ]);

    const [limits, minutesThisMonth] = workspace
      ? await Promise.all([
          usageService.limitsFor(workspace),
          usageService.minutesThisPeriod(workspace._id),
        ])
      : [null, 0];

    return {
      user: {
        ...user,
        id: user._id,
        admin: isPlatformAdmin(user),
        superAdmin: isSuperAdmin(user.email),
        source: user.source || "signup",
        blocked: Boolean(user.blockedAt),
        blockedBy: user.blockedBy?.email || null,
      },
      workspace: workspace && { _id: workspace._id, name: workspace.name, createdAt: workspace.createdAt },
      subscription: subscription && {
        plan: subscription.plan,
        planId: subscription.planId?._id || null,
        planName: subscription.planId?.name || null,
        status: subscription.status,
        assignedAt: subscription.assignedAt || null,
      },
      credits: workspace ? await creditService.summary(workspace) : null,
      limits,
      minutesThisMonth: minutes(minutesThisMonth * 60),
      stats: {
        avatars: avatars.length,
        documents,
        calls: totals.calls,
        calls7d: totals7d.calls,
        minutes: minutes(totals.seconds),
        costCents: totals.costCents,
        lastCallAt: conversations[0]?.createdAt || null,
      },
      avatars,
      conversations: conversations.map((c) => ({
        id: c._id,
        avatar: c.avatarId?.name || "Deleted avatar",
        source: c.source,
        guest: c.guest?.name || null,
        status: c.status,
        startedAt: c.startedAt || c.createdAt,
        durationSec: c.durationSec || 0,
        costCents: c.costCents || 0,
        endReason: c.endReason || null,
      })),
    };
  },
};

/* ---------------------------------------------------------------- actions */

Object.assign(adminService, {
  /**
   * Blocks an account: sign-in, token refresh and every API call are refused
   * from now on, refresh tokens are revoked, its live calls are ended, and -
   * for a workspace owner - its avatars stop answering share links.
   *
   * Admins cannot be blocked (demote them first), and nobody can block
   * themselves.
   */
  async block(id, { reason }, { admin, ip }) {
    await blockUser(id, { reason }, { admin, ip });
    return this.getUser(id);
  },

  async unblock(id, { admin, ip }) {
    await unblockUser(id, { admin, ip });
    return this.getUser(id);
  },

  /** Puts the user's workspace on a plan; its limits apply from the next call. */
  async assignPlan(id, { planId }, { admin, ip }) {
    await assignPlanTo(id, planId, { admin, ip });
    return this.getUser(id);
  },
});

/**
 * The block, unblock and assign steps, without the trailing re-read, so the
 * Edit User flow can chain them in one save.
 */
export async function blockUser(id, { reason }, { admin, ip }) {
  const user = await User.findById(id).select("email platformAdmin workspaceId").lean();
  if (!user) throw notFound();
  if (String(user._id) === String(admin._id)) throw fail(422, "You cannot block yourself.");
  if (isPlatformAdmin(user)) throw fail(422, "Admins cannot be blocked. Demote them first.");

  await User.updateOne(
    { _id: user._id },
    { $set: { blockedAt: new Date(), blockedReason: reason || undefined, blockedBy: admin._id } },
  );
  await authService.revokeAll(user._id);
  const ended = await endLiveCalls(user);

  await audit({
    workspaceId: user.workspaceId,
    admin,
    action: "admin.user.block",
    target: userTarget(user),
    meta: { reason, endedCalls: ended },
    ip,
  });
  logger.info({ userId: String(user._id), endedCalls: ended }, "user blocked by admin");
}

export async function unblockUser(id, { admin, ip }) {
  const user = await User.findById(id).select("workspaceId").lean();
  if (!user) throw notFound();

  await User.updateOne({ _id: user._id }, { $unset: { blockedAt: "", blockedReason: "", blockedBy: "" } });
  await audit({ workspaceId: user.workspaceId, admin, action: "admin.user.unblock", target: userTarget(user), ip });
}

export async function assignPlanTo(id, planId, { admin, ip }) {
  const user = await User.findById(id).select("workspaceId").lean();
  if (!user) throw notFound();
  if (!user.workspaceId) throw fail(422, "This user has no workspace to put on a plan.");

  const plan = await Plan.findById(planId).lean();
  if (!plan) throw fail(404, "Plan not found");
  if (!plan.active) throw fail(422, "That plan is archived and cannot be assigned.");

  const from = await plansService.assign({ workspaceId: user.workspaceId, plan, assignedBy: admin._id });
  await audit({
    workspaceId: user.workspaceId,
    admin,
    action: "admin.plan.assign",
    target: userTarget(user),
    meta: { from, to: plan.key },
    ip,
  });
  return plan;
}

const userTarget = (user) => ({ kind: "user", id: String(user._id) });

async function sumCalls(match) {
  const [row] = await Conversation.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        calls: { $sum: 1 },
        seconds: { $sum: "$durationSec" },
        costCents: { $sum: "$costCents" },
      },
    },
  ]);
  return row || { calls: 0, seconds: 0, costCents: 0 };
}

const USER_ROW_FIELDS =
  "email name role platformAdmin organization source workspaceId createdAt lastLoginAt blockedAt";

/**
 * The MongoDB filter for the Users tab and its export: free-text search,
 * status (a block is what "suspended" means here), plan, and source.
 */
export async function userFilter({ q, status, plan, source } = {}) {
  const clauses = [];

  if (q) {
    clauses.push({
      $or: [
        { email: { $regex: escapeRegex(q), $options: "i" } },
        { name: { $regex: escapeRegex(q), $options: "i" } },
      ],
    });
  }
  if (status === "active") clauses.push({ blockedAt: null });
  if (status === "suspended") clauses.push({ blockedAt: { $ne: null } });
  // Accounts from before `source` existed have none, and were all sign-ups.
  if (source === "signup") clauses.push({ $or: [{ source: "signup" }, { source: null }] });
  else if (source) clauses.push({ source });
  if (plan) {
    const subs = await Subscription.find({ planId: plan }).select("workspaceId").lean();
    clauses.push({ workspaceId: { $in: subs.map((s) => s.workspaceId) } });
  }

  return clauses.length ? { $and: clauses } : {};
}

/**
 * Turns user documents into what a list row shows: identity and status, the
 * plan with its minutes and the bonus on top, the workspace, and usage.
 * Avatars, calls and minutes are per workspace, so a row's figures are its
 * workspace's.
 */
export async function userRows(users) {
  const workspaceIds = users.map((u) => u.workspaceId).filter(Boolean);
  const [avatarCounts, callStats, subscriptions, workspaces, creditAccounts, rates] = await Promise.all([
    Avatar.aggregate([
      { $match: { workspaceId: { $in: workspaceIds }, draft: { $ne: true } } },
      { $group: { _id: "$workspaceId", n: { $sum: 1 } } },
    ]),
    Conversation.aggregate([
      { $match: { workspaceId: { $in: workspaceIds } } },
      {
        $group: {
          _id: "$workspaceId",
          calls: { $sum: 1 },
          seconds: { $sum: "$durationSec" },
          lastCallAt: { $max: "$createdAt" },
        },
      },
    ]),
    Subscription.find({ workspaceId: { $in: workspaceIds } })
      .select("workspaceId plan planId includedMinutes")
      .populate("planId", "name includedMinutes monthlyCredits unlimitedCredits")
      .lean(),
    Workspace.find({ _id: { $in: workspaceIds } }).select("name").lean(),
    CreditAccount.find({ workspaceId: { $in: workspaceIds } }).select("workspaceId balance").lean(),
    getRates(),
  ]);

  const balances = new Map(creditAccounts.map((a) => [String(a.workspaceId), a.balance]));
  const avatars = keyed(avatarCounts);
  const calls = keyed(callStats);
  const subs = new Map(subscriptions.map((s) => [String(s.workspaceId), s]));
  const spaces = new Map(workspaces.map((w) => [String(w._id), w]));

  return users.map((u) => {
    const ws = String(u.workspaceId);
    const stat = calls.get(ws);
    const sub = subs.get(ws);
    const space = spaces.get(ws);
    const admin = isPlatformAdmin(u);
    return {
      id: u._id,
      email: u.email,
      name: u.name || null,
      organization: u.organization || null,
      source: u.source || "signup",
      role: admin ? "admin" : "user",
      admin,
      superAdmin: isSuperAdmin(u.email),
      blocked: Boolean(u.blockedAt),
      status: u.blockedAt ? "suspended" : "active",
      plan: sub?.planId?.name || sub?.plan || null,
      planId: sub?.planId?._id || null,
      // What the plan gives each month, and what is left now.
      planCredits: sub?.planId ? planCredits(sub.planId, rates) : 0,
      unlimited: Boolean(sub?.planId?.unlimitedCredits),
      credits: round2(balances.get(ws) || 0),
      workspace: space ? { id: space._id, name: space.name } : null,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt || null,
      lastCallAt: stat?.lastCallAt || null,
      avatars: avatars.get(ws)?.n || 0,
      calls: stat?.calls || 0,
      minutes: minutes(stat?.seconds || 0),
    };
  });
}

const keyed = (rows) => new Map(rows.map((r) => [String(r._id), r]));

async function usersById(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select("email name").lean();
  return new Map(users.map((u) => [String(u._id), { id: u._id, email: u.email, name: u.name || null }]));
}

/** One user's list row, or null if they are gone. */
export async function userRowById(id) {
  const user = await User.findById(id).select(USER_ROW_FIELDS).lean();
  return user ? (await userRows([user]))[0] : null;
}
