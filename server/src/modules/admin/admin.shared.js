import { AuditLog, Conversation, User, Workspace } from "../../models/index.js";
import { roomService } from "../rooms/room.service.js";
import { logger } from "../../config/logger.js";

/** What the admin services share: error helpers, the audit trail, ending calls. */

export const fail = (status, message) => {
  const err = new Error(message);
  err.statusCode = status;
  return err;
};

export const notFound = () => fail(404, "User not found");

/**
 * Writes an admin action to a workspace's audit log. A user's actions go in
 * their own workspace; actions with no workspace of their own (an invitation, a
 * deleted account) go in the acting admin's.
 */
export async function audit({ workspaceId, admin, action, target, meta, ip }) {
  if (!workspaceId) return;
  await AuditLog.create({ workspaceId, actorId: admin._id, action, target, meta, ip }).catch((err) =>
    logger.warn({ err: err.message, action }, "audit log write failed"),
  );
}

/** The acting admin's workspace, for actions that belong to nobody else's. */
export async function adminWorkspaceId(admin) {
  const row = await User.findById(admin._id).select("workspaceId").lean();
  return row?.workspaceId;
}

/**
 * Ends what a blocked or deleted user has running. For a workspace owner that
 * is every call in the workspace, share-link calls included; for a member,
 * their own.
 */
export async function endLiveCalls(user, endReason = "account blocked") {
  if (!user.workspaceId) return 0;
  const workspace = await Workspace.findById(user.workspaceId);
  if (!workspace) return 0;

  const owner = String(workspace.ownerId) === String(user._id);
  const live = await Conversation.find({
    workspaceId: workspace._id,
    status: { $in: ["pending", "active"] },
    ...(owner ? {} : { userId: user._id }),
  })
    .select("_id")
    .lean();

  for (const c of live) {
    await roomService
      .endCall({ workspace, conversationId: c._id, endReason })
      .catch((err) => logger.warn({ err: err.message, conversationId: String(c._id) }, "could not end call"));
  }
  return live.length;
}
