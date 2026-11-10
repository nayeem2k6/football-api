import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { CommentModel } from "../../database/models/comment.model";
import { CommentReportModel } from "../../database/models/comment-report.model";
import { LikeModel } from "../../database/models/like.model";
import { NewsArticleModel } from "../../database/models/news-article.model";
import { VideoModel } from "../../database/models/video.model";
import { HttpError } from "../../shared/http-error";
import {
  commentRateLimit,
  reactionRateLimit,
  socialReportRateLimit,
} from "../../middleware/user-action-rate-limit";
import { requireAuth } from "../auth/auth.middleware";

export const socialRouter = Router();

const targetSchema = z.object({
  targetType: z.enum(["video", "article"]),
  targetId: z.string().refine(Types.ObjectId.isValid),
});
const populatedAuthorSchema = z.object({
  _id: z.instanceof(Types.ObjectId),
  username: z.string(),
  displayName: z.string().nullable(),
});

function parseTarget(parameters: Record<string, unknown>) {
  const target = targetSchema.parse(parameters);
  return { ...target, objectId: new Types.ObjectId(target.targetId) };
}

async function requireVisibleTarget(
  targetType: "video" | "article",
  targetId: Types.ObjectId,
): Promise<void> {
  const visible =
    targetType === "video"
      ? await VideoModel.exists({ _id: targetId, status: "approved" })
      : await NewsArticleModel.exists({ _id: targetId, status: "published" });
  if (!visible) {
    throw new HttpError(404, "CONTENT_NOT_FOUND", "This content was not found.");
  }
}

function encodeCursor(createdAt: Date, id: Types.ObjectId): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id: id.toString() }),
  ).toString("base64url");
}

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
      createdAt: z.string().datetime(),
      id: z.string().refine(Types.ObjectId.isValid),
    })
    .safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, "INVALID_CURSOR", "The pagination cursor is invalid.");
  }
  return {
    createdAt: new Date(parsed.data.createdAt),
    id: new Types.ObjectId(parsed.data.id),
  };
}

function formatAuthor(input: unknown) {
  const parsed = populatedAuthorSchema.safeParse(input);
  return parsed.success
    ? {
        id: parsed.data._id.toString(),
        username: parsed.data.username,
        displayName: parsed.data.displayName,
      }
    : null;
}

socialRouter.get("/:targetType/:targetId", async (request, response, next) => {
  try {
    const target = parseTarget(request.params);
    await requireVisibleTarget(target.targetType, target.objectId);
    const filter = {
      targetType: target.targetType,
      targetId: target.objectId,
    };
    const [likeCount, commentCount] = await Promise.all([
      LikeModel.countDocuments(filter),
      CommentModel.countDocuments({ ...filter, deletedAt: null }),
    ]);
    response.status(200).json({ likeCount, commentCount });
  } catch (error) {
    next(error);
  }
});

socialRouter.get(
  "/:targetType/:targetId/like",
  requireAuth,
  reactionRateLimit,
  async (request, response, next) => {
    try {
      const target = parseTarget(request.params);
      await requireVisibleTarget(target.targetType, target.objectId);
      const user = request.user;
      if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
      const liked = await LikeModel.exists({
        userId: new Types.ObjectId(user.id),
        targetType: target.targetType,
        targetId: target.objectId,
      });
      response.status(200).json({ liked: Boolean(liked) });
    } catch (error) {
      next(error);
    }
  },
);

socialRouter.put(
  "/:targetType/:targetId/like",
  requireAuth,
  reactionRateLimit,
  async (request, response, next) => {
    try {
      const target = parseTarget(request.params);
      await requireVisibleTarget(target.targetType, target.objectId);
      const user = request.user;
      if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
      try {
        await LikeModel.updateOne(
          {
            userId: new Types.ObjectId(user.id),
            targetType: target.targetType,
            targetId: target.objectId,
          },
          {
            $setOnInsert: {
              userId: new Types.ObjectId(user.id),
              targetType: target.targetType,
              targetId: target.objectId,
            },
          },
          { upsert: true, runValidators: true },
        );
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== 11000
        ) {
          throw error;
        }
      }
      response.status(200).json({ liked: true });
    } catch (error) {
      next(error);
    }
  },
);

socialRouter.delete(
  "/:targetType/:targetId/like",
  requireAuth,
  reactionRateLimit,
  async (request, response, next) => {
    try {
      const target = parseTarget(request.params);
      await requireVisibleTarget(target.targetType, target.objectId);
      const user = request.user;
      if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
      await LikeModel.deleteOne({
        userId: new Types.ObjectId(user.id),
        targetType: target.targetType,
        targetId: target.objectId,
      });
      response.status(200).json({ liked: false });
    } catch (error) {
      next(error);
    }
  },
);

socialRouter.get("/:targetType/:targetId/comments", async (request, response, next) => {
  try {
    const target = parseTarget(request.params);
    await requireVisibleTarget(target.targetType, target.objectId);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.string().max(512).optional(),
      })
      .parse(request.query);
    const cursor = decodeCursor(query.cursor);
    const comments = await CommentModel.find({
      targetType: target.targetType,
      targetId: target.objectId,
      deletedAt: null,
      ...(cursor
        ? {
            $or: [
              { createdAt: { $lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
            ],
          }
        : {}),
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .populate("authorId", "displayName username")
      .lean();
    const hasMore = comments.length > query.limit;
    const page = hasMore ? comments.slice(0, query.limit) : comments;
    const lastComment = page.at(-1);
    response.status(200).json({
      comments: page.map((comment) => {
        const author = formatAuthor(comment.authorId);
        return {
          id: comment._id.toString(),
          body: comment.body,
          createdAt: comment.createdAt,
          author,
        };
      }),
      nextCursor:
        hasMore && lastComment
          ? encodeCursor(lastComment.createdAt, lastComment._id)
          : null,
    });
  } catch (error) {
    next(error);
  }
});

socialRouter.post(
  "/comments/:commentId/reports",
  requireAuth,
  socialReportRateLimit,
  async (request, response, next) => {
    try {
      const { commentId } = z
        .object({ commentId: z.string().refine(Types.ObjectId.isValid) })
        .parse(request.params);
      const user = request.user;
      if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
      const input = z
        .object({
          reason: z.enum(["harassment", "spam", "hate", "other"]),
          details: z.string().trim().max(500).default(""),
        })
        .strict()
        .parse(request.body);
      const comment = await CommentModel.findOne({
        _id: commentId,
        deletedAt: null,
      })
        .select("authorId")
        .lean();
      if (!comment) {
        throw new HttpError(404, "COMMENT_NOT_FOUND", "This comment was not found.");
      }
      if (comment.authorId.toString() === user.id) {
        throw new HttpError(400, "INVALID_REPORT", "You cannot report your own comment.");
      }
      await CommentReportModel.create({
        commentId: comment._id,
        reporterId: new Types.ObjectId(user.id),
        ...input,
        status: "open",
        moderatorNote: null,
      });
      response.status(201).json({ submitted: true });
    } catch (error) {
      next(error);
    }
  },
);

socialRouter.post(
  "/:targetType/:targetId/comments",
  requireAuth,
  commentRateLimit,
  async (request, response, next) => {
    try {
      const target = parseTarget(request.params);
      await requireVisibleTarget(target.targetType, target.objectId);
      const user = request.user;
      if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
      const input = z
        .object({ body: z.string().trim().min(1).max(1000) })
        .strict()
        .parse(request.body);
      const comment = await CommentModel.create({
        ...input,
        targetType: target.targetType,
        targetId: target.objectId,
        authorId: new Types.ObjectId(user.id),
      });
      const populated = await CommentModel.findById(comment._id)
        .populate("authorId", "displayName username")
        .lean();
      if (!populated) {
        throw new HttpError(500, "COMMENT_SAVE_FAILED", "The comment could not be loaded.");
      }
      const author = formatAuthor(populated.authorId);
      response.status(201).json({
        comment: {
          id: populated._id.toString(),
          body: populated.body,
          createdAt: populated.createdAt,
          author,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

socialRouter.delete(
  "/comments/:commentId",
  requireAuth,
  async (request, response, next) => {
    try {
      const { commentId } = z
        .object({ commentId: z.string().refine(Types.ObjectId.isValid) })
        .parse(request.params);
      const user = request.user;
      if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
      const result = await CommentModel.updateOne(
        {
          _id: commentId,
          authorId: new Types.ObjectId(user.id),
          deletedAt: null,
        },
        { $set: { deletedAt: new Date() } },
      );
      if (result.matchedCount === 0) {
        throw new HttpError(404, "COMMENT_NOT_FOUND", "This comment was not found.");
      }
      response.status(200).json({ deleted: true });
    } catch (error) {
      next(error);
    }
  },
);
