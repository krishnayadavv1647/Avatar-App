import { User } from "../models/index.js";

/**
 * Who a person is in their workspace, read from the database on each request.
 * The role in their access token is only as fresh as their last sign-in, and
 * roles change (an owner promotes someone, or removes them).
 *
 * Roles: the owner (made the workspace) can do everything; an admin runs the
 * team and the billing; a member uses the avatars and nothing else.
 */
export async function loadActor(req, res, next) {
  try {
    const actor = await User.findById(req.auth.userId).select("name email role workspaceId").lean();
    if (!actor || !req.workspace || String(actor.workspaceId) !== String(req.workspace._id)) {
      const err = new Error("Authentication required");
      err.statusCode = 401;
      throw err;
    }
    req.actor = actor;
    next();
  } catch (err) {
    next(err);
  }
}

/** Owners and admins only. Use after `resolveWorkspace` and `loadActor`. */
export function requireManager(req, res, next) {
  if (!["owner", "admin"].includes(req.actor?.role)) {
    const err = new Error("Only the workspace owner or an admin can do that.");
    err.statusCode = 403;
    err.code = "not_a_manager";
    return next(err);
  }
  next();
}
