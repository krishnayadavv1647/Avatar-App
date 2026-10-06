import { logger } from "../config/logger.js";
import { isProd } from "../config/env.js";
import { errorDetails, logError } from "../utils/errorLog.js";

/** 404 for anything the routers did not claim. */
export function notFound(req, res) {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}` } });
}

/**
 * Single place errors become responses.
 *
 * Adapter errors already carry a `statusCode` (NotSupportedError is 422,
 * UnavailableInRuntimeError is 501), so a vendor limitation surfaces as a
 * meaningful status rather than a blanket 500.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Multer's own errors carry no status: an oversized upload is a 413 with a
  // plain message, not a 500.
  if (err.name === "MulterError") {
    err.statusCode = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    if (err.code === "LIMIT_FILE_SIZE") err.message = "That file is too large.";
  }
  const status = err.statusCode || err.status || 500;

  // An error that set its own status is a decision we made - a vendor that
  // cannot do something, an input we rejected - not a fault. Only unlabelled
  // errors are genuinely unexpected and worth a stack trace.
  const deliberate = Boolean(err.statusCode || err.status);

  if (deliberate) {
    logger.warn({ msg: err.message, name: err.name, path: req.path, status }, "request rejected");
  } else {
    logger.error({ err, path: req.path, method: req.method }, "request failed");
    // Shown in the admin's Error Logs tab. Only faults, not deliberate rejections.
    logError({
      errorType: "REQUEST_FAILED",
      message: err.message,
      functionName: `${req.method} ${req.path}`,
      userEmail: undefined,
      details: errorDetails(err, { userId: req.auth?.userId }),
    });
  }

  res.status(status).json({
    error: {
      message: err.message || "Internal server error",
      name: err.name,
      // A machine-readable reason the client can act on, e.g. "account_blocked".
      // Only strings: driver errors carry numeric codes that mean nothing here.
      ...(typeof err.code === "string" ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
      // A 500 can carry internals; never leak them in production.
      ...(!isProd && status >= 500 ? { stack: err.stack } : {}),
    },
  });
}
