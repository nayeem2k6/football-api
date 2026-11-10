import { Schema, model, Types } from "mongoose";

export type CommentReportStatus = "open" | "resolved" | "dismissed";

interface CommentReportRecord {
  commentId: Types.ObjectId;
  reporterId: Types.ObjectId;
  reason: "harassment" | "spam" | "hate" | "other";
  details: string;
  status: CommentReportStatus;
  moderatorNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const commentReportSchema = new Schema<CommentReportRecord>(
  {
    commentId: { type: Schema.Types.ObjectId, ref: "Comment", required: true },
    reporterId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: {
      type: String,
      enum: ["harassment", "spam", "hate", "other"],
      required: true,
    },
    details: { type: String, trim: true, maxlength: 500, default: "" },
    status: {
      type: String,
      enum: ["open", "resolved", "dismissed"],
      required: true,
      default: "open",
    },
    moderatorNote: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true, versionKey: false },
);

commentReportSchema.index({ reporterId: 1, commentId: 1 }, { unique: true });
commentReportSchema.index({ status: 1, createdAt: 1 });

export const CommentReportModel = model<CommentReportRecord>(
  "CommentReport",
  commentReportSchema,
);
