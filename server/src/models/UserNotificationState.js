import mongoose from "mongoose";

/**
 * When a person last looked at their notifications. Anything published after
 * this is "new". One row per user, kept apart from User so the notification
 * feature does not reach into the account model.
 */
const userNotificationStateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    lastCheckAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export const UserNotificationState = mongoose.model("UserNotificationState", userNotificationStateSchema);
