import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

export const systemValidation = {
  tz: { query: z.object({ tz: z.string().trim().max(64).optional() }) },

  creditUsage: {
    query: z.object({
      // Today, a week, a month, a quarter - the period picker's options.
      days: z.coerce
        .number()
        .int()
        .refine((d) => [1, 7, 30, 90].includes(d), "days must be 1, 7, 30 or 90")
        .default(30),
      tz: z.string().trim().max(64).optional(),
    }),
  },

  // Dollars per minute. A provider left out falls back to its default.
  costRules: {
    body: z.object({
      rules: z.record(z.string().max(40), z.coerce.number().min(0, "A cost cannot be negative").max(1000)),
    }),
  },

  serviceName: { params: z.object({ serviceName: z.string().trim().min(1).max(40) }) },

  updateApiConfig: {
    params: z.object({ serviceName: z.string().trim().min(1).max(40) }),
    body: z
      .object({
        // Only sent when the admin typed a new key; absent or empty keeps the saved one.
        apiKey: z.string().trim().min(8, "That does not look like an API key").max(500).optional(),
        clearKey: z.boolean().optional(),
        baseUrl: z
          .string()
          .trim()
          .max(500)
          .refine((v) => v === "" || /^https?:\/\//i.test(v), "Base URL must start with http:// or https://")
          .optional(),
        isActive: z.boolean().optional(),
      })
      .strict(),
  },

  saveConfig: {
    body: z.object({ settings: z.record(z.string().max(60), z.string().max(4096)) }),
  },

  errorLogs: {
    query: z.object({
      q: z.string().trim().max(100).optional(),
      severity: z.enum(["CRITICAL", "ERROR", "WARNING", "INFO"]).optional(),
      status: z.enum(["NEW", "ACKNOWLEDGED", "RESOLVED"]).optional(),
      sort: z.enum(["timestamp", "severity"]).default("timestamp"),
      dir: z.enum(["asc", "desc"]).default("desc"),
      page: z.coerce.number().int().min(1).max(100_000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
  },
  errorLogStatus: {
    params: z.object({ id: objectId }),
    body: z.object({ status: z.enum(["NEW", "ACKNOWLEDGED", "RESOLVED"]) }),
  },
  errorLogId: { params: z.object({ id: objectId }) },
};
