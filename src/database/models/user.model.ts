import { Schema, model } from "mongoose";

export type UserRole = "user" | "admin";
export type UserStatus = "active" | "suspended";

export interface UserRecord {
  firebaseUid: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoUrl: string | null;
  bio: string;
  stripeConnectAccountId: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserRecord>(
  {
    firebaseUid: { type: String, required: true, immutable: true },
    username: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-z0-9_]+$/,
    },
    email: { type: String, default: null, lowercase: true, trim: true },
    emailVerified: { type: Boolean, required: true, default: false },
    displayName: { type: String, default: null, trim: true, maxlength: 100 },
    photoUrl: { type: String, default: null, maxlength: 2048 },
    bio: { type: String, default: "", trim: true, maxlength: 280 },
    stripeConnectAccountId: { type: String, default: null, select: false },
    role: { type: String, enum: ["user", "admin"], required: true, default: "user" },
    status: {
      type: String,
      enum: ["active", "suspended"],
      required: true,
      default: "active",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

userSchema.index({ firebaseUid: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });

export const UserModel = model<UserRecord>("User", userSchema);
