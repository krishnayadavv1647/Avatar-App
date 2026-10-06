import { verifyAccessToken } from "../modules/auth/auth.service.js";

/**
 * Populates req.auth from a bearer token.
 *
 * Deliberately does not reject an anonymous request - that is `requireAuth`'s
 * job. Splitting them lets a route be readable by anyone while still knowing
 * who the caller is when they are signed in.
 */
export function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) return next();

  try {
    const claims = verifyAccessToken(token);
    req.auth = {
      userId: claims.sub,
      workspaceId: claims.wsp || null,
      role: claims.role,
      // Set only on a token an admin got by acting as this user.
      impersonatedBy: claims.imp || null,
    };
  } catch {
    // An expired or malformed token is the same as none. The client refreshes
    // on a 401 from requireAuth, so failing loudly here would only duplicate it.
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.auth?.userId) {
    const err = new Error("Authentication required");
    err.statusCode = 401;
    return next(err);
  }
  next();
}

/** @param {...('owner'|'admin'|'member')} roles */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth?.userId) {
      const err = new Error("Authentication required");
      err.statusCode = 401;
      return next(err);
    }
    if (!roles.includes(req.auth.role)) {
      const err = new Error(`Requires role: ${roles.join(" or ")}`);
      err.statusCode = 403;
      return next(err);
    }
    next();
  };
}
