import { Schema, model, Types } from "mongoose";
import type { EngagementTargetType } from "./like.model";

interface CommentRecord {
  targetType: EngagementTargetType;
  targetId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<CommentRecord>(
  {
    targetType: { type: String, enum: ["video", "article"], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

commentSchema.index({ targetType: 1, targetId: 1, deletedAt: 1, createdAt: -1 });
commentSchema.index({ authorId: 1, createdAt: -1 });

export const CommentModel = model<CommentRecord>("Comment", commentSchema);
