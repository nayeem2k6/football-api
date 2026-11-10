import { Schema, model, Types } from "mongoose";

interface FollowRecord {
  followerId: Types.ObjectId;
  followeeId: Types.ObjectId;
  createdAt: Date;
}

const followSchema = new Schema<FollowRecord>(
  {
    followerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    followeeId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

followSchema.index({ followerId: 1, followeeId: 1 }, { unique: true });
followSchema.index({ followeeId: 1, createdAt: -1 });
followSchema.index({ followerId: 1, createdAt: -1 });

export const FollowModel = model<FollowRecord>("Follow", followSchema);
