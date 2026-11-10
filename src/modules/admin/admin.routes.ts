import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { AdminAuditLogModel } from "../../database/models/admin-audit-log.model";
import { CommentModel } from "../../database/models/comment.model";
import { CommentReportModel } from "../../database/models/comment-report.model";
import { UserModel } from "../../database/models/user.model";
import { HttpError } from "../../shared/http-error";
import { requireAdmin, writeAdminAudit } from "../../shared/admin";
import { requireAuth } from "../auth/auth.middleware";

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use((request, _response, next) => {
  try {
    requireAdmin(request);
    next();
  } catch (error) {
    next(error);
  }
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(512).optional(),
});

function parseCursor(cursor: string | undefined) {
  if (!cursor) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_CURSOR", "The pagination cursor is invalid.");
  }
  const parsed = z
    .object({
      createdAt: z.string().datetime(),
      id: z.string().refine(Types.ObjectId.isValid),
    })
    .safeParse(decoded);
  if (!parsed.success) {
    throw new HttpError(400, "INVALID_CURSOR", "The pagination cursor is invalid.");
  }
  return {
    createdAt: new Date(parsed.data.createdAt),
    id: new Types.ObjectId(parsed.data.id),
  };
}

function makeCursor(date: Date, id: Types.ObjectId) {
  return Buffer.from(
    JSON.stringify({ createdAt: date.toISOString(), id: id.toString() }),
  ).toString("base64url");
}

adminRouter.get("/users", async (request, response, next) => {
  try {
    const query = paginationSchema.parse(request.query);
    const cursor = parseCursor(query.cursor);
    const users = await UserModel.find(
      cursor
        ? {
            $or: [
              { createdAt: { $lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
            ],
          }
        : {},
    )
      .select("username displayName email role status createdAt")
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean();
    const hasMore = users.length > query.limit;
    const page = hasMore ? users.slice(0, query.limit) : users;
    const last = page.at(-1);
    response.status(200).json({
      users: page.map((user) => ({
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
      })),
      nextCursor: hasMore && last ? makeCursor(last.createdAt, last._id) : null,
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/users/:userId", async (request, response, next) => {
  try {
    const actor = request.user;
    if (!actor) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
    const { userId } = z
      .object({ userId: z.string().refine(Types.ObjectId.isValid) })
      .parse(request.params);
    const input = z
      .object({
        role: z.enum(["user", "admin"]).optional(),
        status: z.enum(["active", "suspended"]).optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, "Provide a role or status change.")
      .parse(request.body);

    if (actor.id === userId) {
      throw new HttpError(400, "CANNOT_UPDATE_SELF", "You cannot change your own account access.");
    }

    const target = await UserModel.findById(userId).select("role status").lean();
    if (!target) throw new HttpError(404, "USER_NOT_FOUND", "This user was not found.");
    const removingAdminAccess =
      target.role === "admin" &&
      ((input.role !== undefined && input.role !== "admin") ||
        input.status === "suspended");
    if (removingAdminAccess) {
      const activeAdmins = await UserModel.countDocuments({
        role: "admin",
        status: "active",
      });
      if (activeAdmins <= 1) {
        throw new HttpError(
          409,
          "LAST_ACTIVE_ADMIN",
          "The last active administrator cannot be demoted or suspended.",
        );
      }
    }

    const actorId = new Types.ObjectId(actor.id);
    const targetId = new Types.ObjectId(userId);
    const previous = { role: target.role, status: target.status };
    const nextRole = input.role ?? target.role;
    const nextStatus = input.status ?? target.status;
    if (previous.role === nextRole && previous.status === nextStatus) {
      throw new HttpError(400, "NO_ACCOUNT_CHANGE", "The requested account state is unchanged.");
    }

    await writeAdminAudit({
      actorId: actor.id,
      action: "user.updated",
      targetType: "user",
      targetId,
      details: {
        previousRole: previous.role,
        previousStatus: previous.status,
        nextRole,
        nextStatus,
      },
    });
    const user = await UserModel.findByIdAndUpdate(
      targetId,
      { $set: { role: nextRole, status: nextStatus } },
      { new: true, runValidators: true },
    )
      .select("username displayName email role status createdAt")
      .lean();
    if (!user) throw new HttpError(404, "USER_NOT_FOUND", "This user was not found.");
    response.status(200).json({
      user: {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/social/reports", async (request, response, next) => {
  try {
    const query = paginationSchema.parse(request.query);
    const reports = await CommentReportModel.find({ status: "open" })
      .sort({ createdAt: 1 })
      .limit(query.limit)
      .populate("reporterId", "username displayName")
      .populate({
        path: "commentId",
        select: "body targetType targetId authorId createdAt deletedAt",
        populate: { path: "authorId", select: "username displayName" },
      })
      .lean();
    response.status(200).json({ reports });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/social/reports/:reportId", async (request, response, next) => {
  try {
    const actor = request.user;
    if (!actor) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
    const { reportId } = z
      .object({ reportId: z.string().refine(Types.ObjectId.isValid) })
      .parse(request.params);
    const input = z
      .object({
        status: z.enum(["resolved", "dismissed"]),
        moderatorNote: z.string().trim().max(500).default(""),
        removeComment: z.boolean().default(false),
      })
      .strict()
      .parse(request.body);
    const reportIdObject = new Types.ObjectId(reportId);
    const report = await CommentReportModel.findOne({
      _id: reportIdObject,
      status: "open",
    })
      .select("commentId")
      .lean();
    if (!report) throw new HttpError(404, "REPORT_NOT_FOUND", "This open report was not found.");

    await writeAdminAudit({
      actorId: actor.id,
      action: "comment-report.resolved",
      targetType: "comment-report",
      targetId: reportIdObject,
      details: {
        status: input.status,
        removeComment: input.removeComment,
        moderatorNote: input.moderatorNote,
      },
    });
    if (input.removeComment) {
      await CommentModel.updateOne(
        { _id: report.commentId, deletedAt: null },
        { $set: { deletedAt: new Date() } },
      );
    }
    await CommentReportModel.updateOne(
      { _id: reportIdObject, status: "open" },
      {
        $set: {
          status: input.status,
          moderatorNote: input.moderatorNote || null,
        },
      },
    );
    response.status(200).json({ status: input.status, commentRemoved: input.removeComment });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/audit-logs", async (request, response, next) => {
  try {
    const query = paginationSchema.parse(request.query);
    const cursor = parseCursor(query.cursor);
    const logs = await AdminAuditLogModel.find(
      cursor
        ? {
            $or: [
              { createdAt: { $lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
            ],
          }
        : {},
    )
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .populate("actorId", "username displayName")
      .lean();
    const hasMore = logs.length > query.limit;
    const page = hasMore ? logs.slice(0, query.limit) : logs;
    const last = page.at(-1);
    response.status(200).json({
      logs: page,
      nextCursor: hasMore && last ? makeCursor(last.createdAt, last._id) : null,
    });
  } catch (error) {
    next(error);
  }
});
