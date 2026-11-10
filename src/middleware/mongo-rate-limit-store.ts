import { createHash } from "node:crypto";
import type { Store } from "express-rate-limit";
import { RateLimitEntryModel } from "../database/models/rate-limit-entry.model";

export class MongoRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 0;

  constructor(private readonly namespace: string) {
    this.prefix = namespace;
  }

  init(options: Parameters<NonNullable<Store["init"]>>[0]): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string) {
    if (this.windowMs <= 0) {
      throw new Error("Rate limit store must be initialized with a positive window.");
    }

    const now = new Date();
    const nextResetTime = new Date(now.getTime() + this.windowMs);
    const id = `${this.namespace}:${createHash("sha256").update(key).digest("hex")}`;
    const expired = {
      $lte: [{ $ifNull: ["$resetTime", new Date(0)] }, now],
    };
    const entry = await RateLimitEntryModel.collection.findOneAndUpdate(
      { key: id },
      [
        {
          $set: {
            namespace: this.namespace,
            totalHits: {
              $add: [
                { $cond: [expired, 0, { $ifNull: ["$totalHits", 0] }] },
                1,
              ],
            },
            resetTime: { $cond: [expired, nextResetTime, "$resetTime"] },
          },
        },
      ],
      { upsert: true, returnDocument: "after" },
    );

    if (!entry) {
      throw new Error("Rate limit counter could not be updated.");
    }

    return { totalHits: entry.totalHits, resetTime: entry.resetTime };
  }

  async decrement(key: string): Promise<void> {
    const id = `${this.namespace}:${createHash("sha256").update(key).digest("hex")}`;
    await RateLimitEntryModel.collection.updateOne(
      { key: id, totalHits: { $gt: 0 } },
      { $inc: { totalHits: -1 } },
    );
  }

  async get(key: string) {
    const id = `${this.namespace}:${createHash("sha256").update(key).digest("hex")}`;
    const entry = await RateLimitEntryModel.collection.findOne({ key: id });
    if (!entry || entry.resetTime <= new Date()) return undefined;
    return { totalHits: entry.totalHits, resetTime: entry.resetTime };
  }

  async resetKey(key: string): Promise<void> {
    const id = `${this.namespace}:${createHash("sha256").update(key).digest("hex")}`;
    await RateLimitEntryModel.collection.deleteOne({ key: id });
  }

  async resetAll(): Promise<void> {
    await RateLimitEntryModel.collection.deleteMany({
      namespace: this.namespace,
    });
  }
}
