import mongoose from "mongoose";

/**
 * Credits: what a call is paid for in. A workspace's balance is the sum of its
 * transactions, kept as a running total on its account so a balance check is
 * one read.
 *
 * Every change is a CreditTransaction - plan grants, admin changes, purchases
 * and each call's usage - and a transaction with a `ref` can only exist once per
 * workspace, which is what makes granting and charging safe to retry.
 */

const accountSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, unique: true },
    balance: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const transactionSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    kind: {
      type: String,
      enum: ["plan_grant", "signup_grant", "admin_grant", "admin_deduct", "purchase", "usage", "refund"],
      required: true,
    },
    // Signed: positive adds credits, negative spends them.
    credits: { type: Number, required: true },
    // The balance right after this one, for the history a person reads.
    balanceAfter: Number,
    // Makes the same grant or charge idempotent: one per workspace.
    ref: String,
    note: String,
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

transactionSchema.index({ workspaceId: 1, createdAt: -1 });
transactionSchema.index({ kind: 1, createdAt: -1 });
transactionSchema.index(
  { workspaceId: 1, ref: 1 },
  { unique: true, partialFilterExpression: { ref: { $type: "string" } } },
);

/** A bundle of credits an admin offers for sale. */
const packSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    credits: { type: Number, required: true, min: 1 },
    priceCents: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "usd", lowercase: true },
    // A short label on the card, e.g. "Most popular".
    badge: { type: String, trim: true },
    displayOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const CreditAccount = mongoose.model("CreditAccount", accountSchema);
export const CreditTransaction = mongoose.model("CreditTransaction", transactionSchema);
export const CreditPack = mongoose.model("CreditPack", packSchema);
