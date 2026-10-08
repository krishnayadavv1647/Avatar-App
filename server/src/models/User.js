import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    // Absent for accounts made through Google, which never set a password.
    passwordHash: { type: String, select: false },
    // Google's stable account id ("sub"), once the person has used Google sign-in.
    googleId: { type: String, unique: true, sparse: true },
    name: { type: String, trim: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", index: true },
    role: { type: String, enum: ["owner", "admin", "member"], default: "owner" },
    lastLoginAt: Date,

    // The profile page. All optional, all the person's own to edit.
    title: { type: String, trim: true },
    phone: { type: String, trim: true },
    // An IANA zone ("Asia/Kolkata"), for showing times the way they read them.
    timezone: { type: String, trim: true },
    // Their picture. `photoKey` is where it sits in storage, kept so a new one can replace it.
    photoUrl: String,
    photoKey: String,
    // Who added them to the workspace, for people created from the Team page.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Bumping this invalidates every outstanding refresh token at once, which
    // is how "sign out everywhere" works without a revocation list.
    tokenVersion: { type: Number, default: 0 },

    // Free text an admin can record ("Acme Inc"). Shown in the admin list.
    organization: { type: String, trim: true },
    // How the account came to exist, for the admin's Source filter. Accounts
    // from before this field have none and read as "signup".
    source: { type: String, enum: ["signup", "invited", "manual"], default: "signup", index: true },
    // Granted by another admin from the Users tab. Together with ADMIN_EMAILS
    // (which stays a superuser list that cannot be demoted here) it decides who
    // is a platform admin - see middleware/admin.js.
    platformAdmin: { type: Boolean, default: false },

    // Set by a platform admin. A blocked user cannot sign in, refresh, call
    // the API, or have their avatars answer share links.
    blockedAt: Date,
    blockedReason: { type: String, trim: true },
    blockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const User = mongoose.model("User", userSchema);
