import { Avatar, Conversation, User, Workspace } from "../../../models/index.js";
import { isPlatformAdmin } from "../../../middleware/admin.js";

/**
 * Every avatar on the platform, with who owns it - the admin's global view of
 * what the "Avatars" page shows one workspace at a time.
 *
 * Read-only. Avatars belong to a workspace; the owner shown is the workspace's
 * owner, which is the person who made it in nearly every case.
 */
const PAGE_SIZE = 24;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const adminAvatarsService = {
  async list({ q, status, provider, page = 1 }) {
    // Preview drafts are scratch work, not avatars anyone has.
    const filter = { draft: { $ne: true } };
    if (status) filter.status = status;
    if (provider) filter.providerId = provider;

    if (q) {
      // Matches the avatar's name, or the name/email of the person who owns it.
      const rx = new RegExp(escapeRegex(q), "i");
      const owners = await User.find({ $or: [{ email: rx }, { name: rx }] }).select("_id").limit(500).lean();
      const workspaces = await Workspace.find({ ownerId: { $in: owners.map((u) => u._id) } })
        .select("_id")
        .lean();
      filter.$or = [{ name: rx }, { workspaceId: { $in: workspaces.map((w) => w._id) } }];
    }

    const [total, avatars, providers] = await Promise.all([
      Avatar.countDocuments(filter),
      Avatar.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .select("name status providerId sourceType gender previewUrl previewVideoUrl share.enabled workspaceId createdAt updatedAt failureReason")
        .lean(),
      Avatar.distinct("providerId"),
    ]);

    const [workspaces, calls] = await Promise.all([
      Workspace.find({ _id: { $in: avatars.map((a) => a.workspaceId) } }).select("ownerId name").lean(),
      Conversation.aggregate([
        { $match: { avatarId: { $in: avatars.map((a) => a._id) } } },
        { $group: { _id: "$avatarId", calls: { $sum: 1 }, seconds: { $sum: "$durationSec" } } },
      ]),
    ]);
    const owners = await User.find({ _id: { $in: workspaces.map((w) => w.ownerId).filter(Boolean) } })
      .select("name email blockedAt platformAdmin")
      .lean();

    const ownerOfWorkspace = new Map(
      workspaces.map((w) => [String(w._id), owners.find((u) => String(u._id) === String(w.ownerId)) || null]),
    );
    const usage = new Map(calls.map((c) => [String(c._id), c]));

    return {
      avatars: avatars.map((a) => {
        const owner = ownerOfWorkspace.get(String(a.workspaceId));
        const used = usage.get(String(a._id));
        return {
          _id: a._id,
          name: a.name,
          status: a.status,
          failureReason: a.failureReason,
          providerId: a.providerId,
          sourceType: a.sourceType,
          gender: a.gender,
          previewUrl: a.previewUrl,
          previewVideoUrl: a.previewVideoUrl,
          shared: Boolean(a.share?.enabled),
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          calls: used?.calls || 0,
          minutes: Math.round(((used?.seconds || 0) / 60) * 10) / 10,
          owner: owner
            ? {
                _id: owner._id,
                name: owner.name,
                email: owner.email,
                blocked: Boolean(owner.blockedAt),
                admin: isPlatformAdmin(owner),
              }
            : null,
        };
      }),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      providers: providers.sort(),
    };
  },
};
