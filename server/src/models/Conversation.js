import mongoose from "mongoose";

/**
 * One live call.
 *
 * `pipelineMode` and `transport` are stored rather than derived because the
 * client needs to know how to connect before it can render anything: a
 * render-only provider joins a LiveKit room we control, a full-pipeline
 * provider hands back its own session on its own transport.
 */
const conversationSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    avatarId: { type: mongoose.Schema.Types.ObjectId, ref: "Avatar", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // "link" calls come from someone outside the workspace through an avatar's
    // share link. They have no user, only the name they typed - which is what
    // the history shows, and what the avatar is told to call them.
    // "meeting" calls are the avatar sitting in a Zoom / Meet / Teams / Webex
    // meeting through LemonSlice; meetingUrl is the meeting it was sent to.
    source: { type: String, enum: ["app", "link", "meeting"], default: "app" },
    meetingUrl: { type: String, trim: true },
    guest: {
      name: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
    },

    roomName: { type: String, required: true, index: true },
    providerId: { type: String, required: true },
    pipelineMode: { type: String, enum: ["render-only", "full-pipeline"], required: true },
    transport: { type: String, enum: ["livekit", "daily", "websocket"], required: true },
    providerSessionId: String,

    status: {
      type: String,
      enum: ["pending", "active", "ended", "failed"],
      default: "pending",
      index: true,
    },
    startedAt: Date,
    endedAt: Date,
    durationSec: { type: Number, default: 0 },
    costCents: { type: Number, default: 0 },
    // Credits per minute this call was started at, fixed for its whole length so a
    // rate change mid-call cannot reprice it; and what it ended up costing.
    creditRate: Number,
    credits: { type: Number, default: 0 },
    endReason: String,
  },
  { timestamps: true },
);

conversationSchema.index({ workspaceId: 1, createdAt: -1 });

export const Conversation = mongoose.model("Conversation", conversationSchema);
