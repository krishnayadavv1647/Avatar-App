import { User } from "../models/index.js";
import { env } from "../config/env.js";

/** Whether an email is on the ADMIN_EMAILS list - the superusers nobody can demote from the app. */
export const isSuperAdmin = (email) =>
  Boolean(email) && env.adminEmails.includes(String(email).toLowerCase());

/**
 * Whether someone is a platform admin: on ADMIN_EMAILS, or granted it by
 * another admin (`platformAdmin`).
 *
 * Takes the user (`{ email, platformAdmin }`). A bare email is still accepted
 * and answers only for the ADMIN_EMAILS half, since a flag cannot be known
 * from an address.
 */
export const isPlatformAdmin = (user) => {
  if (!user) return false;
  if (typeof user === "string") return isSuperAdmin(user);
  return Boolean(user.platformAdmin) || isSuperAdmin(user.email);
};

/**
 * Lets platform admins through; everyone else gets a 403.
 *
 * Checked against the user's current record on every request, not a token
 * claim, so removing someone from ADMIN_EMAILS or demoting them takes effect
 * at once.
 */
export async function requirePlatformAdmin(req, res, next) {
  try {
    const user = await User.findById(req.auth?.userId).select("email platformAdmin").lean();
    if (!user || !isPlatformAdmin(user)) {
      const err = new Error("Admin access required");
      err.statusCode = 403;
      throw err;
    }
    req.admin = user;
    next();
  } catch (err) {
    next(err);
  }
}
