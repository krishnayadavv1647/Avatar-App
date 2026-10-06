import { getRates, minutesFor, planCredits } from "../billing/credit.service.js";
import { z } from "zod";
import { EmailList, EmailListMember, Subscription, User } from "../../models/index.js";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

/**
 * Who a mailing is for, as criteria rather than a list of addresses.
 *
 * The server turns criteria into recipients at send time. A client-supplied
 * address list would let anyone with the endpoint mail arbitrary people, and a
 * scheduled email would go stale: criteria keep it true to who is in the
 * audience when it actually goes out.
 *
 * - all: every user (filtered by `status`)
 * - selected_users: exactly the users in `userIds`
 * - plans: users on (or, with planMode "without", not on) any of `planIds`; no plans means no plan filter
 * - lists: the active members of the active lists in `listIds`
 */
export const audienceSchema = z
  .object({
    mode: z.enum(["all", "selected_users", "plans", "lists"]).default("all"),
    status: z.enum(["all", "active", "suspended"]).default("all"),
    userIds: z.array(objectId).max(5000).default([]),
    planIds: z.array(objectId).max(200).default([]),
    planMode: z.enum(["with", "without"]).default("with"),
    listIds: z.array(objectId).max(200).default([]),
    // Skips addresses that have bounced on any list.
    excludeBounced: z.boolean().default(true),
  })
  .strict();

/**
 * @param {unknown} criteria
 * @returns {Promise<Array<{ email: string, name: string, planName: string, minutes: number|undefined, userId?: string }>>}
 *          one entry per distinct address
 */
export async function resolveAudience(criteria) {
  const a = audienceSchema.parse(criteria ?? {});

  let people = [];
  if (a.mode === "lists") {
    people = await listMembers(a.listIds);
  } else {
    people = await users(a);
  }

  if (a.excludeBounced && people.length) {
    const bounced = await EmailListMember.distinct("email", {
      status: "bounced",
      email: { $in: people.map((p) => p.email) },
    });
    const skip = new Set(bounced);
    people = people.filter((p) => !skip.has(p.email));
  }

  const seen = new Set();
  return people.filter((p) => (seen.has(p.email) ? false : (seen.add(p.email), true)));
}

/** Users matching all/selected_users/plans, each with the plan their workspace is on. */
async function users(a) {
  const filter = {};
  if (a.mode === "selected_users") {
    if (!a.userIds.length) return [];
    filter._id = { $in: a.userIds };
  } else if (a.status === "active") {
    filter.blockedAt = { $exists: false };
  } else if (a.status === "suspended") {
    filter.blockedAt = { $exists: true };
  }

  const found = await User.find(filter).select("email name workspaceId").lean();
  const plans = await planByWorkspace(found.map((u) => u.workspaceId).filter(Boolean));

  let people = found.map((u) => {
    const plan = plans.get(String(u.workspaceId));
    return {
      userId: String(u._id),
      email: u.email,
      name: u.name || "",
      planId: plan?.id,
      planName: plan?.name || "Free",
      minutes: plan?.minutes,
    };
  });

  if (a.mode === "plans" && a.planIds.length) {
    const wanted = new Set(a.planIds);
    people = people.filter((p) => wanted.has(p.planId) === (a.planMode === "with"));
  }
  return people;
}

/** Active members of active lists, enriched with the plan of the registered user behind the address. */
async function listMembers(listIds) {
  if (!listIds.length) return [];
  const lists = await EmailList.find({ _id: { $in: listIds }, isActive: true }).select("_id").lean();
  const members = await EmailListMember.find({ listId: { $in: lists.map((l) => l._id) }, status: "active" })
    .select("email fullName userId")
    .lean();

  const known = await User.find({ email: { $in: members.map((m) => m.email) } }).select("email name workspaceId").lean();
  const byEmail = new Map(known.map((u) => [u.email, u]));
  const plans = await planByWorkspace(known.map((u) => u.workspaceId).filter(Boolean));

  return members.map((m) => {
    const user = byEmail.get(m.email);
    const plan = user && plans.get(String(user.workspaceId));
    return {
      userId: user ? String(user._id) : undefined,
      email: m.email,
      name: m.fullName || user?.name || "",
      planName: plan?.name || "Free",
      minutes: plan?.minutes,
    };
  });
}

/** workspaceId -> { id, name, minutes } of the plan its subscription points at. */
async function planByWorkspace(workspaceIds) {
  const subscriptions = await Subscription.find({ workspaceId: { $in: workspaceIds } })
    .select("workspaceId planId includedMinutes")
    .populate("planId", "name includedMinutes monthlyCredits unlimitedCredits")
    .lean();
  const rates = await getRates();
  return new Map(
    subscriptions.map((s) => [
      String(s.workspaceId),
      {
        id: s.planId ? String(s.planId._id) : undefined,
        name: s.planId?.name,
        minutes: s.planId ? minutesFor(planCredits(s.planId, rates), rates.standard) : s.includedMinutes,
      },
    ]),
  );
}
