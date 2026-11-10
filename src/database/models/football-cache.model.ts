import { Schema, model } from "mongoose";

interface FootballCacheRecord {
  cacheKey: string;
  payload: unknown;
  fetchedAt: Date;
  freshUntil: Date;
  staleUntil: Date;
  deleteAt: Date;
}

const footballCacheSchema = new Schema<FootballCacheRecord>(
  {
    cacheKey: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, required: true },
    freshUntil: { type: Date, required: true },
    staleUntil: { type: Date, required: true },
    deleteAt: { type: Date, required: true },
  },
  { versionKey: false },
);

footballCacheSchema.index({ cacheKey: 1 }, { unique: true });
footballCacheSchema.index({ deleteAt: 1 }, { expireAfterSeconds: 0 });

export const FootballCacheModel = model<FootballCacheRecord>(
  "FootballCache",
  footballCacheSchema,
);
