import { Schema, model, Types } from "mongoose";

export type NewsCategory = "news" | "transfers" | "tactics" | "interviews";
export type NewsArticleStatus = "draft" | "published";

export interface NewsArticleRecord {
  title: string;
  slug: string;
  summary: string;
  body: string;
  category: NewsCategory;
  sourceName: string;
  sourceUrl: string | null;
  authorId: Types.ObjectId;
  status: NewsArticleStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const newsArticleSchema = new Schema<NewsArticleRecord>(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 160,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    summary: { type: String, required: true, trim: true, maxlength: 280 },
    body: { type: String, required: true, trim: true, maxlength: 20000 },
    category: {
      type: String,
      enum: ["news", "transfers", "tactics", "interviews"],
      required: true,
    },
    sourceName: { type: String, required: true, trim: true, maxlength: 120 },
    sourceUrl: { type: String, default: null, maxlength: 2048 },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["draft", "published"],
      required: true,
      default: "draft",
    },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

newsArticleSchema.index({ slug: 1 }, { unique: true });
newsArticleSchema.index({ status: 1, publishedAt: -1 });

export const NewsArticleModel = model<NewsArticleRecord>(
  "NewsArticle",
  newsArticleSchema,
);
