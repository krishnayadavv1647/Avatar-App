import mongoose from "mongoose";

/**
 * A person who gave their details to an avatar during a call, saved as data
 * rather than left in a transcript.
 *
 * One lead per person per avatar: the same email (or, failing that, the same
 * phone number) calling again updates the lead and adds the call, so an owner
 * sees "Priya, 3 calls" instead of three rows. `phoneKey` is the number's
 * digits only, which is what the match is made on.
 */
const leadSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    avatarId: { type: mongoose.Schema.Types.ObjectId, ref: "Avatar", required: true, index: true },
    conversationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Conversation" }],

    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    phoneKey: { type: String, index: true },
    requirement: { type: String, trim: true },

    status: { type: String, enum: ["new", "contacted", "closed"], default: "new" },
    calls: { type: Number, default: 1 },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

leadSchema.index({ workspaceId: 1, avatarId: 1, email: 1 });
leadSchema.index({ workspaceId: 1, createdAt: -1 });

/**
 * A visitor who asked for a person. Saved first and notified second, so a
 * failed email never loses the request: the owner can still find it here.
 */
const handoffSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    avatarId: { type: mongoose.Schema.Types.ObjectId, ref: "Avatar", required: true },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", index: true },

    name: { type: String, trim: true },
    contact: { type: String, trim: true },
    reason: { type: String, trim: true },
    preferredTime: { type: String, trim: true },

    status: { type: String, enum: ["open", "done"], default: "open" },
    notified: { type: Boolean, default: false },
    notifyError: String,
  },
  { timestamps: true },
);

handoffSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });

export const Lead = mongoose.model("Lead", leadSchema);
export const Handoff = mongoose.model("Handoff", handoffSchema);
