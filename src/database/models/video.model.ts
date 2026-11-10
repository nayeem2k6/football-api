import { Schema, model, Types } from "mongoose";

export type VideoStatus = "pending" | "approved" | "rejected";

export interface VideoRecord {
  publicId: string;
  title: string;
  description: string;
  playbackUrl: string;
  thumbnailUrl: string;
  duration: number;
  bytes: number;
  creatorId: Types.ObjectId;
  status: VideoStatus;
  moderationNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const videoSchema = new Schema<VideoRecord>(
  {
    publicId: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    playbackUrl: { type: String, required: true, maxlength: 2048 },
    thumbnailUrl: { type: String, required: true, maxlength: 2048 },
    duration: { type: Number, required: true, min: 0, max: 600 },
    bytes: { type: Number, required: true, min: 1, max: 100_000_000 },
    creatorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      required: true,
      default: "pending",
    },
    moderationNote: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true, versionKey: false },
);

videoSchema.index({ status: 1, createdAt: -1 });
videoSchema.index({ creatorId: 1, createdAt: -1 });

export const VideoModel = model<VideoRecord>("Video", videoSchema);
