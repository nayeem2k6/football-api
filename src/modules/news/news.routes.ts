import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { requireAuth } from "../auth/auth.middleware";
import { NewsArticleModel } from "../../database/models/news-article.model";
import { HttpError } from "../../shared/http-error";
import { writeAdminAudit } from "../../shared/admin";

export const newsRouter = Router();

const categories = ["news", "transfers", "tactics", "interviews"] as const;
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(512).optional(),
});

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_CURSOR", "The pagination cursor is invalid.");
  }

  const parsed = z
    .object({
      date: z.string().datetime(),
      id: z.string().refine(Types.ObjectId.isValid),
    })
    .safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, "INVALID_CURSOR", "The pagination cursor is invalid.");
  }

  return {
    date: new Date(parsed.data.date),
    id: new Types.ObjectId(parsed.data.id),
  };
}

function encodeCursor(date: Date, id: Types.ObjectId) {
  return Buffer.from(JSON.stringify({ date: date.toISOString(), id: id.toString() }))
    .toString("base64url");
}

const articleInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    summary: z.string().trim().min(1).max(280),
    body: z.string().trim().min(1).max(20000),
    category: z.enum(categories),
    sourceName: z.string().trim().min(1).max(120),
    sourceUrl: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .url()
        .max(2048)
        .refine((value) => new URL(value).protocol === "https:")
        .optional(),
    ),
    status: z.enum(["draft", "published"]),
  })
  .strict();

function requireAdmin(request: Parameters<typeof requireAuth>[0]) {
  if (!request.user || request.user.role !== "admin") {
    throw new HttpError(403, "ADMIN_REQUIRED", "An administrator account is required.");
  }
  return request.user;
}

function articleResponse(article: {
  _id: Types.ObjectId;
  title: string;
  slug: string;
  summary: string;
  body: string;
  category: string;
  sourceName: string;
  sourceUrl: string | null;
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  authorId:
    | Types.ObjectId
    | { displayName: string | null; username: string };
}) {
  const author =
    typeof article.authorId === "object" && "username" in article.authorId
      ? {
          displayName: article.authorId.displayName,
          username: article.authorId.username,
        }
      : null;

  return {
    id: article._id.toString(),
    title: article.title,
    slug: article.slug,
    summary: article.summary,
    body: article.body,
    category: article.category,
    sourceName: article.sourceName,
    sourceUrl: article.sourceUrl,
    status: article.status,
    publishedAt: article.publishedAt,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
    author,
  };
}

newsRouter.get("/", async (request, response, next) => {
  try {
    const query = z
      .object({
        category: z.enum(categories).optional(),
        ...paginationSchema.shape,
      })
      .parse(request.query);
    const cursor = decodeCursor(query.cursor);
    const filters = {
      status: "published",
      ...(query.category ? { category: query.category } : {}),
    };
    const articles = await NewsArticleModel.find({
      ...filters,
      ...(cursor
        ? {
            $or: [
              { publishedAt: { $lt: cursor.date } },
              { publishedAt: cursor.date, _id: { $lt: cursor.id } },
            ],
          }
        : {}),
    })
      .sort({ publishedAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .populate("authorId", "displayName username")
      .lean();

    const hasMore = articles.length > query.limit;
    const page = hasMore ? articles.slice(0, query.limit) : articles;
    const lastArticle = page.at(-1);
    response.status(200).json({
      articles: page.map(articleResponse),
      nextCursor:
        hasMore && lastArticle?.publishedAt
          ? encodeCursor(lastArticle.publishedAt, lastArticle._id)
          : null,
    });
  } catch (error) {
    next(error);
  }
});

newsRouter.get("/admin/articles", requireAuth, async (request, response, next) => {
  try {
    requireAdmin(request);
    const query = paginationSchema.parse(request.query);
    const cursor = decodeCursor(query.cursor);
    const articles = await NewsArticleModel.find(
      cursor
        ? {
            $or: [
              { updatedAt: { $lt: cursor.date } },
              { updatedAt: cursor.date, _id: { $lt: cursor.id } },
            ],
          }
        : {},
    )
      .sort({ updatedAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .populate("authorId", "displayName username")
      .lean();
    const hasMore = articles.length > query.limit;
    const page = hasMore ? articles.slice(0, query.limit) : articles;
    const lastArticle = page.at(-1);
    response.status(200).json({
      articles: page.map(articleResponse),
      nextCursor: hasMore && lastArticle
        ? encodeCursor(lastArticle.updatedAt, lastArticle._id)
        : null,
    });
  } catch (error) {
    next(error);
  }
});

newsRouter.post("/admin/articles", requireAuth, async (request, response, next) => {
  try {
    const admin = requireAdmin(request);
    const input = articleInputSchema.parse(request.body);
    const article = await NewsArticleModel.create({
      ...input,
      sourceUrl: input.sourceUrl ?? null,
      authorId: new Types.ObjectId(admin.id),
      publishedAt: input.status === "published" ? new Date() : null,
    });
    const populated = await NewsArticleModel.findById(article._id)
      .populate("authorId", "displayName username")
      .lean();
    if (!populated) {
      throw new HttpError(500, "ARTICLE_SAVE_FAILED", "The article could not be loaded.");
    }
    response.status(201).json({ article: articleResponse(populated) });
  } catch (error) {
    next(error);
  }
});

newsRouter.get("/:slug", async (request, response, next) => {
  try {
    const { slug } = z
      .object({
        slug: z
          .string()
          .min(1)
          .max(160)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      })
      .parse(request.params);
    const article = await NewsArticleModel.findOne({
      slug,
      status: "published",
    })
      .populate("authorId", "displayName username")
      .lean();

    if (!article) {
      throw new HttpError(404, "ARTICLE_NOT_FOUND", "This article was not found.");
    }
    response.status(200).json({ article: articleResponse(article) });
  } catch (error) {
    next(error);
  }
});

newsRouter.patch(
  "/admin/articles/:articleId",
  requireAuth,
  async (request, response, next) => {
    try {
      requireAdmin(request);
      const { articleId } = z
        .object({ articleId: z.string().refine(Types.ObjectId.isValid) })
        .parse(request.params);
      const input = articleInputSchema.parse(request.body);
      const existing = await NewsArticleModel.findById(articleId).select("publishedAt").lean();
      if (!existing) {
        throw new HttpError(404, "ARTICLE_NOT_FOUND", "This article was not found.");
      }

      const actor = request.user;
      if (!actor) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
      await writeAdminAudit({
        actorId: actor.id,
        action: "article.updated",
        targetType: "article",
        targetId: new Types.ObjectId(articleId),
        details: {
          title: input.title,
          slug: input.slug,
          status: input.status,
        },
      });
      const article = await NewsArticleModel.findByIdAndUpdate(
        articleId,
        {
          $set: {
            ...input,
            sourceUrl: input.sourceUrl ?? null,
            publishedAt:
              input.status === "draft"
                ? null
                : existing.publishedAt ?? new Date(),
          },
        },
        { new: true, runValidators: true },
      )
        .populate("authorId", "displayName username")
        .lean();

      if (!article) {
        throw new HttpError(404, "ARTICLE_NOT_FOUND", "This article was not found.");
      }
      response.status(200).json({ article: articleResponse(article) });
    } catch (error) {
      next(error);
    }
  },
);
