import crypto from "node:crypto";
import { Plan, Subscription } from "../../models/index.js";
import { PLAN_TEMPLATES } from "./plan.templates.js";
import { getStorage } from "../../integrations/storage/registry.js";
import { logger } from "../../config/logger.js";
import { ensureGrants, getRates, planCredits } from "../billing/credit.service.js";
import { fail } from "./admin.shared.js";

/**
 * Plans, as admins manage them.
 *
 * A plan's key is fixed once created - it is what subscriptions and reports
 * show - while everything else can change, and takes effect for everyone on
 * the plan straight away (see usageService.limitsFor). That is also why saving
 * a plan needs no "recalculate its users" step, unlike a system that copies
 * limits onto each user.
 */

const THUMBNAIL_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Plan plus how many workspaces are on it, and what it gives each month. A plan
 * made before credits existed has no monthlyCredits of its own; it is shown at
 * what its minutes are worth, so the admin sees what users actually get.
 */
async function withUsers(plans) {
  const rates = await getRates();
  const counts = await Subscription.aggregate([
    { $match: { planId: { $in: plans.map((p) => p._id) } } },
    { $group: { _id: "$planId", n: { $sum: 1 } } },
  ]);
  const byPlan = new Map(counts.map((c) => [String(c._id), c.n]));
  return plans.map((p) => ({ ...p, monthlyCredits: planCredits(p, rates), users: byPlan.get(String(p._id)) || 0 }));
}

/** Only one default: making a plan default clears it everywhere else. */
async function claimDefault(planId) {
  await Plan.updateMany({ _id: { $ne: planId }, isDefault: true }, { $set: { isDefault: false } });
}

/**
 * The storage key of a thumbnail this service uploaded, or null for any other
 * URL. Matched strictly on the shape put() produces, so a URL typed by an admin
 * can never point a delete at something else.
 */
const ownThumbnailKey = (url) => /(plans\/[0-9a-f-]{36}\.(?:jpg|png|webp))$/.exec(url || "")?.[1] || null;

async function dropThumbnail(url) {
  const key = ownThumbnailKey(url);
  if (!key) return;
  await getStorage()
    .remove(key)
    .catch((err) => logger.warn({ err: err.message, key }, "could not remove plan thumbnail"));
}

export const plansService = {
  async list() {
    const plans = await Plan.find().sort({ displayOrder: 1, createdAt: 1, _id: 1 }).lean();
    return withUsers(plans);
  },

  async create(fields, adminId) {
    if (await Plan.exists({ key: fields.key })) {
      throw fail(409, `A plan with the key "${fields.key}" already exists.`);
    }
    if (fields.isDefault && fields.active === false) {
      throw fail(422, "An archived plan cannot be the default for new sign-ups.");
    }
    const plan = await Plan.create({ ...fields, createdBy: adminId });
    if (plan.isDefault) await claimDefault(plan._id);
    return (await withUsers([plan.toObject()]))[0];
  },

  async update(id, fields) {
    const plan = await Plan.findById(id);
    if (!plan) throw fail(404, "Plan not found");

    const next = { ...plan.toObject(), ...fields };
    if (next.isDefault && next.active === false) {
      throw fail(422, "An archived plan cannot be the default for new sign-ups.");
    }

    const replacedThumbnail =
      fields.thumbnailUrl !== undefined && fields.thumbnailUrl !== plan.thumbnailUrl ? plan.thumbnailUrl : null;

    Object.assign(plan, fields);
    await plan.save();
    if (plan.isDefault) await claimDefault(plan._id);
    if (replacedThumbnail) await dropThumbnail(replacedThumbnail);

    // More monthly credits reach everyone on the plan now, rather than the next
    // time each of them looks - so the numbers an admin sees are the real ones.
    if (fields.monthlyCredits !== undefined) {
      const onPlan = await Subscription.find({ planId: plan._id }).select("workspaceId").lean();
      for (const { workspaceId } of onPlan) {
        await ensureGrants(workspaceId).catch((err) =>
          logger.warn({ err: err.message, workspaceId: String(workspaceId) }, "could not top up plan credits"),
        );
      }
    }
    return (await withUsers([plan.toObject()]))[0];
  },

  /**
   * Stores a plan's thumbnail and returns its URL; the admin saves the plan
   * with it. An upload nobody saves stays behind - small, and the same trade
   * the avatar uploads make.
   */
  async uploadThumbnail(file) {
    if (!file) throw fail(422, "No image uploaded");
    const extension = THUMBNAIL_TYPES[file.mimetype];
    if (!extension) throw fail(422, "Use a JPG, PNG or WebP image.");
    if (file.size > THUMBNAIL_MAX_BYTES) throw fail(413, "Image must be 5 MB or smaller.");

    const stored = await getStorage().put({
      buffer: file.buffer,
      key: `plans/${crypto.randomUUID()}${extension}`,
      contentType: file.mimetype,
    });
    return { thumbnailUrl: stored.publicUrl };
  },

  /**
   * Adds the ready-made plans whose keys are not taken yet. Safe to run again:
   * anything already there, edited or not, is left alone.
   */
  async addTemplates(adminId) {
    const taken = new Set((await Plan.find().select("key").lean()).map((p) => p.key));
    const missing = PLAN_TEMPLATES.filter((t) => !taken.has(t.key));
    if (missing.length) {
      await Plan.insertMany(missing.map((t) => ({ ...t, createdBy: adminId })));
    }
    return {
      added: missing.map((t) => t.key),
      skipped: PLAN_TEMPLATES.filter((t) => taken.has(t.key)).map((t) => t.key),
      plans: await this.list(),
    };
  },

  /** Only a plan nobody is on; one that is in use is archived instead. */
  async remove(id) {
    const plan = await Plan.findById(id).lean();
    if (!plan) throw fail(404, "Plan not found");

    const users = await Subscription.countDocuments({ planId: id });
    if (users > 0) {
      throw fail(409, `${users} user${users === 1 ? " is" : "s are"} on this plan. Archive it instead, or move them first.`);
    }
    await Plan.deleteOne({ _id: id });
    await dropThumbnail(plan.thumbnailUrl);
    return { id };
  },

  /**
   * Puts a workspace on a plan; its limits apply from the next call. Used by an
   * admin assigning a plan and by someone accepting an invitation, so both do
   * exactly the same thing. Returns the plan key it replaced.
   */
  async assign({ workspaceId, plan, assignedBy }) {
    const previous = await Subscription.findOne({ workspaceId }).select("plan").lean();
    await Subscription.updateOne(
      { workspaceId },
      {
        $set: {
          plan: plan.key,
          planId: plan._id,
          assignedAt: new Date(),
          assignedBy,
          status: "active",
        },
      },
      { upsert: true },
    );
    // The plan's credits are on the account straight away, not at the next look.
    await ensureGrants(workspaceId).catch((err) =>
      logger.warn({ err: err.message, workspaceId: String(workspaceId) }, "could not grant plan credits"),
    );
    return previous?.plan || null;
  },
};
