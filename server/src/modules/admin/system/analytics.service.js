import { Avatar, Conversation, Subscription, UsageLedger, User } from "../../../models/index.js";
import { CAPABILITIES, PROVIDER_IDS, isDevelopmentOnly } from "../../../avatar/capabilities.js";
import { configService } from "./config.service.js";

/**
 * The Analytics and Credit Usage tabs.
 *
 * Domain mapping from the reference app: its "credits" are call minutes, a
 * "generation" is a call, a "model" is the avatar vendor (providerId) and a
 * "project" is an avatar.
 *
 * Both tabs aggregate in MongoDB; nothing here loads call rows into memory.
 */

const round = (n, places = 1) => {
  const f = 10 ** places;
  return Math.round((Number(n) || 0) * f) / f;
};

/* ------------------------------------------------------------- time zones */

/** A timezone Intl accepts, or UTC. */
export function safeZone(tz) {
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

/** Wall-clock parts of an instant in `tz`. */
function parts(ts, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(new Date(ts))
      .map((x) => [x.type, Number(x.value)]),
  );
  return p;
}

/** How far `tz` is ahead of UTC at an instant. */
const offsetMs = (ts, tz) => {
  const p = parts(ts, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
};

/** The instant at which a wall-clock midnight (given as a UTC-midnight stand-in) happens in `tz`. */
function zonedMidnight(utcMidnight, tz) {
  // Twice, because the offset at the guess can differ from the offset at the answer around a DST change.
  const first = utcMidnight - offsetMs(utcMidnight, tz);
  return new Date(utcMidnight - offsetMs(first, tz));
}

/** Midnight at the start of the day `daysAgo` days before today, in `tz`. */
export function startOfDay(now, tz, daysAgo = 0) {
  const p = parts(now, tz);
  return zonedMidnight(Date.UTC(p.year, p.month - 1, p.day - daysAgo), tz);
}

/** Midnight on the 1st of the month `monthsAgo` months before this one, in `tz`. */
export function startOfMonth(now, tz, monthsAgo = 0) {
  const p = parts(now, tz);
  return zonedMidnight(Date.UTC(p.year, p.month - 1 - monthsAgo, 1), tz);
}

/* ----------------------------------------------------------------- analytics */

async function periodTotals(from, to) {
  const createdAt = to ? { $gte: from, $lt: to } : { $gte: from };
  const [calls, avatars] = await Promise.all([
    Conversation.aggregate([
      { $match: { createdAt } },
      { $group: { _id: null, calls: { $sum: 1 }, seconds: { $sum: "$durationSec" } } },
    ]),
    Avatar.countDocuments({ createdAt }),
  ]);
  return { calls: calls[0]?.calls || 0, minutes: round((calls[0]?.seconds || 0) / 60), avatars };
}

/** Percent change from `previous` to `current`; null when there is nothing to compare against. */
const change = (current, previous) => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : null);

export const analyticsService = {
  async analytics({ tz }) {
    const zone = safeZone(tz);
    const now = Date.now();
    // Calendar months in the admin's timezone, year included, so January is
    // compared with last December and not with the same month a year earlier.
    const thisStart = startOfMonth(now, zone, 0);
    const prevStart = startOfMonth(now, zone, 1);

    const [current, previous] = await Promise.all([periodTotals(thisStart), periodTotals(prevStart, thisStart)]);

    const [topRows, recent] = await Promise.all([
      Conversation.aggregate([
        { $match: { createdAt: { $gte: thisStart }, userId: { $ne: null } } },
        { $group: { _id: "$userId", seconds: { $sum: "$durationSec" }, calls: { $sum: 1 } } },
        { $sort: { seconds: -1, calls: -1 } },
        { $limit: 5 },
      ]),
      Conversation.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate("avatarId", "name")
        .populate("userId", "email name")
        .select("avatarId userId source guest status durationSec createdAt")
        .lean(),
    ]);

    const users = await User.find({ _id: { $in: topRows.map((r) => r._id) } })
      .select("email name workspaceId")
      .lean();
    const subscriptions = await Subscription.find({ workspaceId: { $in: users.map((u) => u.workspaceId) } })
      .select("workspaceId plan planId")
      .populate("planId", "name")
      .lean();
    const planByWorkspace = new Map(subscriptions.map((s) => [String(s.workspaceId), s.planId?.name || s.plan]));
    const userById = new Map(users.map((u) => [String(u._id), u]));

    return {
      timezone: zone,
      monthStart: thisStart,
      month: {
        calls: { value: current.calls, change: change(current.calls, previous.calls) },
        minutes: { value: current.minutes, change: change(current.minutes, previous.minutes) },
        avatars: { value: current.avatars, change: change(current.avatars, previous.avatars) },
      },
      topUsers: topRows
        .map((r) => {
          const u = userById.get(String(r._id));
          return u && {
            id: u._id,
            name: u.name || null,
            email: u.email,
            minutes: round(r.seconds / 60),
            calls: r.calls,
            plan: planByWorkspace.get(String(u.workspaceId)) || null,
          };
        })
        .filter(Boolean),
      recent: recent.map((c) => ({
        id: c._id,
        source: c.source,
        status: c.status,
        avatar: c.avatarId?.name || "Deleted avatar",
        user: c.userId?.email || null,
        guest: c.guest?.name || null,
        minutes: round((c.durationSec || 0) / 60),
        createdAt: c.createdAt,
      })),
    };
  },

  /* ------------------------------------------------------------ credit usage */

  /**
   * The $/min each vendor really charges us: what the admin saved on the Cost
   * rules tab, else the planning figure in capabilities.js. Every known vendor
   * is listed, used or not.
   */
  async rules() {
    const saved = await configService.costRules();
    return PROVIDER_IDS.map((providerId) => {
      const defaultRate = CAPABILITIES[providerId].approxCostPerMinUsd;
      const custom = Number.isFinite(Number(saved[providerId])) && saved[providerId] !== null && saved[providerId] !== "";
      return {
        providerId,
        rate: custom ? Number(saved[providerId]) : defaultRate,
        defaultRate,
        custom,
        developmentOnly: isDevelopmentOnly(providerId),
      };
    });
  },

  /**
   * Minutes and cost over the last `days` days, three ways: by avatar, by
   * vendor and by user.
   *
   * "Estimated" is the ledger's costCents - minutes times the planning rate in
   * capabilities.js, recorded when the call ended. "Actual" is the same minutes
   * times the rate the admin entered for that vendor. "Difference" is
   * estimated minus actual: positive means the ledger over-states what the
   * vendors really cost us, negative means it under-states it. Until a rule is
   * changed the two use the same rate, so the difference is zero - it only
   * becomes informative once the real price is entered.
   *
   * Today means since local midnight; N days means the last N calendar days
   * including today.
   */
  async creditUsage({ days, tz }) {
    const zone = safeZone(tz);
    const since = startOfDay(Date.now(), zone, days - 1);
    const rules = await this.rules();
    const rate = Object.fromEntries(rules.map((r) => [r.providerId, r.rate]));

    // One group per (vendor, avatar, user) - bounded by combinations, not by
    // calls - then rolled up three ways below with names attached.
    const combos = await UsageLedger.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $lookup: {
          from: Conversation.collection.name,
          localField: "conversationId",
          foreignField: "_id",
          pipeline: [{ $project: { avatarId: 1, userId: 1 } }],
          as: "call",
        },
      },
      { $unwind: { path: "$call", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { provider: "$providerId", avatar: "$call.avatarId", user: "$call.userId" },
          // Adjustments and training are not calls.
          uses: { $sum: { $cond: [{ $eq: ["$kind", "conversation"] }, 1, 0] } },
          minutes: { $sum: "$minutes" },
          costCents: { $sum: "$costCents" },
        },
      },
    ]);

    const [avatars, users] = await Promise.all([
      Avatar.find({ _id: { $in: combos.map((c) => c._id.avatar).filter(Boolean) } }).select("name").lean(),
      User.find({ _id: { $in: combos.map((c) => c._id.user).filter(Boolean) } }).select("email").lean(),
    ]);
    const avatarName = new Map(avatars.map((a) => [String(a._id), a.name]));
    const userEmail = new Map(users.map((u) => [String(u._id), u.email]));

    const groups = { avatar: new Map(), provider: new Map(), user: new Map(), total: blank("total", "Total") };
    const add = (map, key, label, c, actualCents) => {
      const g = map.get(key) || map.set(key, blank(key, label)).get(key);
      g.uses += c.uses;
      g.minutes += c.minutes;
      g.estimatedCents += c.costCents;
      g.actualCents += actualCents;
    };

    for (const c of combos) {
      const { provider, avatar, user } = c._id;
      const actualCents = c.minutes * (rate[provider] ?? 0) * 100;

      add(groups.avatar, String(avatar || "none"), avatar ? avatarName.get(String(avatar)) || "Deleted avatar" : "Not linked to an avatar", c, actualCents);
      add(groups.provider, provider || "unknown", provider || "unknown", c, actualCents);
      add(groups.user, String(user || "none"), user ? userEmail.get(String(user)) || "Deleted user" : "Guests / not linked to a user", c, actualCents);
      groups.total.uses += c.uses;
      groups.total.minutes += c.minutes;
      groups.total.estimatedCents += c.costCents;
      groups.total.actualCents += actualCents;
    }

    // Fixed order, like the reference: biggest estimated cost first.
    const finish = (map) =>
      [...map.values()].map(tidy).sort((a, b) => b.estimatedCents - a.estimatedCents || b.minutes - a.minutes);

    return {
      days,
      timezone: zone,
      since,
      totals: tidy(groups.total),
      byAvatar: finish(groups.avatar),
      byProvider: finish(groups.provider),
      byUser: finish(groups.user),
      rules,
    };
  },
};

const blank = (key, label) => ({ key, label, uses: 0, minutes: 0, estimatedCents: 0, actualCents: 0 });

/** Rounded, with the difference worked out. */
function tidy(g) {
  const estimatedCents = round(g.estimatedCents, 2);
  const actualCents = round(g.actualCents, 2);
  return {
    key: g.key,
    label: g.label,
    uses: g.uses,
    minutes: round(g.minutes, 2),
    estimatedCents,
    actualCents,
    differenceCents: round(estimatedCents - actualCents, 2),
  };
}
