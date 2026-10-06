import { ErrorLog } from "../models/index.js";
import { logger } from "../config/logger.js";

/**
 * Records an error for the admin's Error Logs tab.
 *
 * Never throws and never waits on the caller's behalf: logging a failure must
 * not become a second failure. Safe to call without awaiting.
 *
 * @param {{ errorType: string, message: string, functionName?: string, userEmail?: string,
 *           details?: unknown, severity?: "INFO"|"WARNING"|"ERROR"|"CRITICAL",
 *           relatedEntityType?: string, relatedEntityId?: string }} entry
 */
export async function logError(entry) {
  try {
    await ErrorLog.create({
      errorType: entry.errorType || "ERROR",
      message: String(entry.message || "Unknown error").slice(0, 2000),
      functionName: entry.functionName,
      userEmail: entry.userEmail,
      details: entry.details,
      severity: entry.severity || "ERROR",
      relatedEntityType: entry.relatedEntityType,
      relatedEntityId: entry.relatedEntityId,
    });
  } catch (err) {
    logger.warn({ err: err.message }, "could not write error log");
  }
}

/** An Error as the `details` payload: name, stack and any extra fields it carries. */
export const errorDetails = (err, extra = {}) => ({
  name: err?.name,
  stack: err?.stack,
  statusCode: err?.statusCode,
  ...extra,
});
