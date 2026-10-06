import { AuditLog, User } from "../../../models/index.js";
import { logger } from "../../../config/logger.js";

/**
 * Records a platform-level change an admin made (a setting, a key).
 *
 * The audit log is per workspace, so it is written to the acting admin's own
 * workspace when they have one; the log line always happens, so the change is
 * traceable either way. Never throws - an audit failure must not undo or block
 * the change it describes. Never put a secret in `meta`.
 */
export async function audit(req, action, meta = {}) {
  logger.info({ admin: req.admin?.email, action, ...meta }, "admin change");
  try {
    const admin = await User.findById(req.admin?._id).select("workspaceId").lean();
    if (!admin?.workspaceId) return;
    await AuditLog.create({
      workspaceId: admin.workspaceId,
      actorId: req.admin._id,
      action,
      target: { kind: "system", id: meta.target || action },
      meta,
      ip: req.ip,
    });
  } catch (err) {
    logger.warn({ err: err.message, action }, "audit log write failed");
  }
}
