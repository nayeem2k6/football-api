import { Schema, model } from "mongoose";

interface RateLimitEntryRecord {
  key: string;
  namespace: string;
  totalHits: number;
  resetTime: Date;
}

const rateLimitEntrySchema = new Schema<RateLimitEntryRecord>(
  {
    key: { type: String, required: true, unique: true },
    namespace: { type: String, required: true },
    totalHits: { type: Number, required: true },
    resetTime: { type: Date, required: true },
  },
  { versionKey: false, collection: "rate_limit_entries" },
);

rateLimitEntrySchema.index({ resetTime: 1 }, { expireAfterSeconds: 0 });
rateLimitEntrySchema.index({ namespace: 1 });

export const RateLimitEntryModel = model<RateLimitEntryRecord>(
  "RateLimitEntry",
  rateLimitEntrySchema,
);
