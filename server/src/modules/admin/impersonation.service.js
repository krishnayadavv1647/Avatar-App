import jwt from "jsonwebtoken";
import { User } from "../../models/index.js";
import { env } from "../../config/env.js";
import { isPlatformAdmin } from "../../middleware/admin.js";
import { publicUser } from "../auth/auth.service.js";
import { audit, fail, notFound } from "./admin.shared.js";

/**
 * "Act as user": an admin signs in as someone else to see what they see and fix
 * what they cannot.
 *
 * The admin gets a normal access token for the target, plus an `imp` claim
 * naming themselves. Deliberately:
 *   - short-lived (an hour) and with no refresh token, so it simply ends;
 *   - never for another admin, so it cannot be used to borrow admin rights or
 *     act as a colleague;
 *   - allowed for a blocked user (an admin often needs to look at exactly that
 *     account), which the workspace check honours only for impersonation;
 *   - recorded in the user's audit log when it starts and ends, and for each
 *     change made in between (middleware/impersonation.js).
 */
export const IMPERSONATION_TTL_SECONDS = 60 * 60;

export const impersonationService = {
  async start(id, { admin, ip }) {
    if (String(id) === String(admin._id)) throw fail(422, "You are already signed in as yourself.");

    const user = await User.findById(id).select("email name role workspaceId platformAdmin blockedAt");
    if (!user) throw notFound();
    if (isPlatformAdmin(user)) throw fail(403, "Admins can't be impersonated.");
    if (!user.workspaceId) throw fail(422, "That user has no workspace to act in.");

    const accessToken = jwt.sign(
      { sub: String(user._id), wsp: String(user.workspaceId), role: user.role, imp: String(admin._id) },
      env.jwt.accessSecret,
      { expiresIn: IMPERSONATION_TTL_SECONDS },
    );

    await audit({
      workspaceId: user.workspaceId,
      admin,
      action: "impersonation.start",
      target: { kind: "user", id: String(user._id) },
      ip,
    });

    return {
      accessToken,
      user: publicUser(user),
      expiresAt: new Date(Date.now() + IMPERSONATION_TTL_SECONDS * 1000).toISOString(),
      blocked: Boolean(user.blockedAt),
    };
  },

  /** Recorded when the admin leaves; the token itself just stops being used. */
  async end({ adminId, userId, workspaceId, ip }) {
    await audit({
      workspaceId,
      admin: { _id: adminId },
      action: "impersonation.end",
      target: { kind: "user", id: String(userId) },
      ip,
    });
  },
};
