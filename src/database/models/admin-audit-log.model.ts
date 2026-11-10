import { Schema, model, Types } from "mongoose";

export type AdminAuditAction =
  | "user.updated"
  | "comment.removed"
  | "comment-report.resolved"
  | "video.moderated"
  | "video-report.resolved"
  | "article.updated";

interface AdminAuditLogRecord {
  actorId: Types.ObjectId;
  action: AdminAuditAction;
  targetType: "user" | "comment" | "comment-report" | "video" | "video-report" | "article";
  targetId: Types.ObjectId;
  details: Record<string, string | boolean | null>;
  createdAt: Date;
}

const adminAuditLogSchema = new Schema<AdminAuditLogRecord>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: {
      type: String,
      enum: [
        "user.updated",
        "comment.removed",
        "comment-report.resolved",
        "video.moderated",
        "video-report.resolved",
        "article.updated",
      ],
      required: true,
    },
    targetType: {
      type: String,
      enum: ["user", "comment", "comment-report", "video", "video-report", "article"],
      required: true,
    },
    targetId: { type: Schema.Types.ObjectId, required: true },
    details: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

adminAuditLogSchema.index({ createdAt: -1, _id: -1 });
adminAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
adminAuditLogSchema.index({ actorId: 1, createdAt: -1 });

export const AdminAuditLogModel = model<AdminAuditLogRecord>(
  "AdminAuditLog",
  adminAuditLogSchema,
);
