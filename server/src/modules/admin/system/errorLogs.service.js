import { ErrorLog } from "../../../models/index.js";

const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Most severe first when sorting by severity descending. */
const RANK = { CRITICAL: 4, ERROR: 3, WARNING: 2, INFO: 1 };

const rankExpr = {
  $switch: {
    branches: Object.entries(RANK).map(([severity, rank]) => ({
      case: { $eq: ["$severity", severity] },
      then: rank,
    })),
    default: 0,
  },
};

export const errorLogsService = {
  /**
   * One page of logs, searched, filtered and sorted in the database.
   * Severity sorts by rank (CRITICAL > ERROR > WARNING > INFO), not alphabetically.
   */
  async list({ q, severity, status, sort, dir, page, limit }) {
    const match = {};
    if (severity) match.severity = severity;
    if (status) match.status = status;
    if (q) {
      const rx = { $regex: escapeRegex(q), $options: "i" };
      match.$or = [{ message: rx }, { userEmail: rx }, { functionName: rx }];
    }

    const direction = dir === "asc" ? 1 : -1;
    // _id breaks ties so pages never repeat or skip a row.
    const order = sort === "severity" ? { rank: direction, timestamp: -1, _id: -1 } : { timestamp: direction, _id: direction };

    const [total, rows, counts] = await Promise.all([
      ErrorLog.countDocuments(match),
      ErrorLog.aggregate([
        { $match: match },
        { $addFields: { rank: rankExpr } },
        { $sort: order },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: { rank: 0, __v: 0 } },
      ]),
      // Unfiltered, so the status filter can show how many are open.
      ErrorLog.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    ]);

    const byStatus = Object.fromEntries(counts.map((c) => [c._id, c.n]));
    return {
      total,
      page,
      pageSize: limit,
      counts: { NEW: byStatus.NEW || 0, ACKNOWLEDGED: byStatus.ACKNOWLEDGED || 0, RESOLVED: byStatus.RESOLVED || 0 },
      logs: rows.map((r) => ({
        id: r._id,
        timestamp: r.timestamp || r.createdAt,
        severity: r.severity,
        status: r.status,
        errorType: r.errorType,
        message: r.message,
        functionName: r.functionName || null,
        userEmail: r.userEmail || null,
        details: r.details ?? {},
        relatedEntityType: r.relatedEntityType || null,
        relatedEntityId: r.relatedEntityId || null,
      })),
    };
  },

  async setStatus(id, status) {
    const log = await ErrorLog.findByIdAndUpdate(id, { $set: { status } }, { new: true }).select("status").lean();
    if (!log) throw fail(404, "Error log not found");
    return { id, status: log.status };
  },

  async remove(id) {
    const { deletedCount } = await ErrorLog.deleteOne({ _id: id });
    if (!deletedCount) throw fail(404, "Error log not found");
    return { deleted: 1 };
  },

  /** Clears everything already marked resolved; open logs are never touched. */
  async clearResolved() {
    const { deletedCount } = await ErrorLog.deleteMany({ status: "RESOLVED" });
    return { deleted: deletedCount };
  },
};
