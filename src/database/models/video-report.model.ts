import { Schema, model, Types } from "mongoose";

export type VideoReportCategory =
  | "copyright"
  | "inappropriate"
  | "spam"
  | "other";
export type VideoReportStatus = "open" | "resolved" | "dismissed";

interface VideoReportRecord {
  videoId: Types.ObjectId;
  reporterId: Types.ObjectId;
  category: VideoReportCategory;
  details: string;
  status: VideoReportStatus;
  moderatorNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const videoReportSchema = new Schema<VideoReportRecord>(
  {
    videoId: { type: Schema.Types.ObjectId, ref: "Video", required: true },
    reporterId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    category: {
      type: String,
      enum: ["copyright", "inappropriate", "spam", "other"],
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

videoReportSchema.index({ reporterId: 1, videoId: 1 }, { unique: true });
videoReportSchema.index({ status: 1, createdAt: 1 });

export const VideoReportModel = model<VideoReportRecord>(
  "VideoReport",
  videoReportSchema,
);
