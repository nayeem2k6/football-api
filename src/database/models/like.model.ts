import { Schema, model, Types } from "mongoose";

export type EngagementTargetType = "video" | "article";

interface LikeRecord {
  userId: Types.ObjectId;
  targetType: EngagementTargetType;
  targetId: Types.ObjectId;
  createdAt: Date;
}

const likeSchema = new Schema<LikeRecord>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    targetType: { type: String, enum: ["video", "article"], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

likeSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true });
likeSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export const LikeModel = model<LikeRecord>("Like", likeSchema);
