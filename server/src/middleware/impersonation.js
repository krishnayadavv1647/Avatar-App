import { AuditLog } from "../models/index.js";
import { logger } from "../config/logger.js";

/**
 * Rules for an admin who is "acting as" a user (see modules/admin/impersonation.service.js).
 *
 * An impersonation token is the target user's identity, so everything they can
 * do the admin can do - which is the point. Two things follow:
 *
 *  1. Things that would leave the admin with a lasting credential for that
 *     account, or lock the real person out, are refused: minting API keys,
 *     OAuth grants, "sign out everywhere", and the admin API itself.
 *  2. Every change is recorded in the user's audit log, with the admin as the
 *     actor, so the account's owner can always see who did what.
 *
 * Reads are not logged - the token is short-lived and its start is.
 */
const REFUSED = [
  /^\/api\/api-keys(\/|$)/,
  /^\/api\/oauth\/(authorize|connections)/,
  /^\/api\/auth\/logout$/,
  /^\/api\/admin(\/|$)/,
  // Spending the user's money is theirs alone to do.
  /^\/api\/billing\/checkout$/,
];

// The one admin-ish call an impersonating session may make: leaving.
const ALLOWED = [/^\/api\/impersonation\/end$/];

export function impersonationGuard(req, res, next) {
  const admin = req.auth?.impersonatedBy;
  if (!admin) return next();

  if (!ALLOWED.some((re) => re.test(req.path)) && REFUSED.some((re) => re.test(req.path))) {
    const err = new Error("This isn't available while acting as another user.");
    err.statusCode = 403;
    err.code = "impersonation_restricted";
    return next(err);
  }

  // Leaving has its own "end" row, so it is not also logged as a change.
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !ALLOWED.some((re) => re.test(req.path))) {
    const workspaceId = req.auth.workspaceId;
    res.on("finish", () => {
      // A refused or failed change did not change anything; not worth a row.
      if (!workspaceId || res.statusCode >= 400) return;
      AuditLog.create({
        workspaceId,
        actorId: admin,
        action: "impersonation.change",
        target: { kind: "user", id: req.auth.userId },
        meta: { method: req.method, path: req.originalUrl.split("?")[0], status: res.statusCode },
        ip: req.ip,
      }).catch((err) => logger.warn({ err: err.message }, "impersonation audit write failed"));
    });
  }

  next();
}
