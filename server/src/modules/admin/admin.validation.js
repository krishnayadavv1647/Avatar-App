import { z } from "zod";
import { authValidation } from "../auth/auth.validation.js";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

/** A web address starting http(s)://, or empty to clear the field. */
const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Must start with http:// or https://");

/** Filters the Users tab and its CSV export share. */
const userFilters = {
  q: z.string().trim().max(100).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  plan: objectId.optional(),
  source: z.enum(["invited", "manual", "signup"]).optional(),
};

const accountFields = {
  name: z.string().trim().min(1, "Full name is required").max(80),
  organization: z.string().trim().max(120),
  status: z.enum(["active", "suspended"]),
  role: z.enum(["user", "admin"]),
  planId: objectId,
};

/**
 * Everything about a plan but its key. Zero max avatars means "no limit"; zero
 * monthly credits means the plan gives none (see unlimitedCredits for no limit).
 */
const planFields = {
  name: z.string().trim().min(1, "Name is required").max(60),
  description: z.string().trim().max(200).optional(),
  priceCents: z.coerce.number().int().min(0).max(10_000_000),
  monthlyCredits: z.coerce.number().int().min(0).max(10_000_000),
  unlimitedCredits: z.boolean(),
  concurrencyLimit: z.coerce.number().int().min(1).max(100),
  maxAvatars: z.coerce.number().int().min(0).max(10_000),
  isDefault: z.boolean(),
  active: z.boolean(),
  displayOrder: z.coerce.number().int().min(0).max(100_000),
  visible: z.boolean(),
  durationType: z.enum(["monthly", "lifetime"]),
  conditionBoxDescription: z.string().trim().max(300),
  purchaseUrl: httpUrl,
  thumbnailUrl: httpUrl,
};

export const adminValidation = {
  overview: {
    query: z.object({ tz: z.string().trim().max(64).optional() }),
  },
  listUsers: {
    query: z.object({ ...userFilters, page: z.coerce.number().int().min(1).max(10_000).default(1) }),
  },
  exportUsers: { query: z.object(userFilters) },
  createUser: {
    body: z
      .object({
        email: z.string().trim().email().max(200),
        // The same rule as signing up, so an admin cannot make a weaker account.
        password: authValidation.register.body.shape.password,
        ...accountFields,
        // Credits to start them with, on top of any the plan gives.
        startingCredits: z.coerce.number().int().min(0).max(1_000_000),
      })
      .partial({ organization: true, status: true, role: true, startingCredits: true, planId: true })
      .strict(),
  },
  updateUser: {
    params: z.object({ id: objectId }),
    // The email is fixed: it is what the person signs in with.
    body: z
      .object({ ...accountFields, blockReason: z.string().trim().max(300) })
      .partial()
      .strict(),
  },

  createInvitation: {
    body: z
      .object({
        email: z.string().trim().email().max(200),
        role: z.enum(["user", "admin"]).default("user"),
        planId: objectId,
        message: z.string().trim().max(500).optional(),
      })
      .strict(),
  },
  listInvitations: {
    query: z.object({ status: z.enum(["pending", "accepted", "expired"]).optional() }),
  },
  byId: { params: z.object({ id: objectId }) },

  block: {
    params: z.object({ id: objectId }),
    body: z.object({ reason: z.string().trim().max(300).optional() }),
  },
  assignPlan: {
    params: z.object({ id: objectId }),
    body: z.object({ planId: objectId }),
  },

  createPlan: {
    body: z
      .object({
        key: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9][a-z0-9-]{1,31}$/, "Use 2-32 lowercase letters, numbers or dashes"),
        ...planFields,
      })
      .partial({
        description: true,
        priceCents: true,
        monthlyCredits: true,
        unlimitedCredits: true,
        concurrencyLimit: true,
        maxAvatars: true,
        isDefault: true,
        active: true,
        displayOrder: true,
        visible: true,
        durationType: true,
        conditionBoxDescription: true,
        purchaseUrl: true,
        thumbnailUrl: true,
      })
      .strict(),
  },
  updatePlan: {
    params: z.object({ id: objectId }),
    // The key is fixed once created, so it is not accepted here.
    body: z.object(planFields).partial().strict(),
  },
};
