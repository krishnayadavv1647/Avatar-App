import mongoose from "mongoose";

/**
 * One picture being made for the avatar creator (Generate image / Edit image).
 *
 * The vendor works asynchronously, so a request returns at once with this
 * task's id and the page polls it. Keeping the task here - rather than passing
 * the vendor's id straight through - ties each one to the person who asked, so
 * nobody can read or fetch another account's picture, and gives the rate limit
 * and the admin something to count.
 */
const imageTaskSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["generate", "edit"], required: true },
    prompt: { type: String, required: true },
    aspectRatio: String,
    model: String,
    providerTaskId: { type: String, required: true },
    status: { type: String, enum: ["pending", "success", "failed"], default: "pending", index: true },
    // The vendor's temporary address for the finished picture.
    resultUrl: String,
    error: String,
    // For an edit: where the source picture was parked so the vendor could fetch it.
    inputKey: String,
    // Mongo removes the task after a week; nothing here is worth keeping longer.
    createdAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 7 * 24 * 3600 } },
  },
  { versionKey: false },
);

export const ImageTask = mongoose.model("ImageTask", imageTaskSchema);
