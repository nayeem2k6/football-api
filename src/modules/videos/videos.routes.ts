import { unlink } from "node:fs/promises";
import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { VideoReportModel } from "../../database/models/video-report.model";
import { VideoModel } from "../../database/models/video.model";
import { UserModel } from "../../database/models/user.model";
import { uploadVideoFile } from "../../integrations/cloudinary/cloudinary";
import { requireAuth } from "../auth/auth.middleware";
import { HttpError } from "../../shared/http-error";
import { requireAdmin, writeAdminAudit } from "../../shared/admin";
import {
  socialReportRateLimit,
  videoUploadRateLimit,
} from "../../middleware/user-action-rate-limit";
import {
  validateVideoFileSignature,
  videoUpload,
} from "./video-upload.middleware";

export const videosRouter = Router();

const videoInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(""),
    rightsConfirmed: z.literal("true"),
  })
  .strict();

function videoResponse(video: {
  _id: Types.ObjectId;
  title: string;
  description: string;
  playbackUrl: string;
  thumbnailUrl: string;
  duration: number;
  status: string;
  moderationNote: string | null;
  createdAt: Date;
  creatorId:
    | Types.ObjectId
    | { displayName: string | null; username: string };
}) {
  const creator =
    typeof video.creatorId === "object" && "username" in video.creatorId
      ? {
          displayName: video.creatorId.displayName,
          username: video.creatorId.username,
        }
      : null;

  return {
    id: video._id.toString(),
    title: video.title,
    description: video.description,
    playbackUrl: video.playbackUrl,
    thumbnailUrl: video.thumbnailUrl,
    duration: video.duration,
    status: video.status,
    moderationNote: video.moderationNote,
    createdAt: video.createdAt,
    creator,
  };
}

videosRouter.get("/users/:username", async (request, response, next) => {
  try {
    const { username } = z
      .object({
        username: z
          .string()
          .trim()
          .toLowerCase()
          .min(3)
          .max(30)
          .regex(/^[a-z0-9_]+$/),
      })
      .parse(request.params);
    const creator = await UserModel.findOne({ username }).select("_id").lean();
    if (!creator) {
      throw new HttpError(404, "USER_NOT_FOUND", "This profile was not found.");
    }
    const videos = await VideoModel.find({
      creatorId: creator._id,
      status: "approved",
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("creatorId", "displayName username")
      .lean();
    response.status(200).json({ videos: videos.map(videoResponse) });
  } catch (error) {
    next(error);
  }
});

videosRouter.get("/", async (request, response, next) => {
  try {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(24) })
      .parse(request.query);
    const videos = await VideoModel.find({ status: "approved" })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .populate("creatorId", "displayName username")
      .lean();
    response.status(200).json({ videos: videos.map(videoResponse) });
  } catch (error) {
    next(error);
  }
});

videosRouter.post(
  "/:videoId/reports",
  requireAuth,
  socialReportRateLimit,
  async (request, response, next) => {
    try {
      const user = request.user;
      if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to report a video.");
      const { videoId } = z
        .object({ videoId: z.string().refine(Types.ObjectId.isValid) })
        .parse(request.params);
      const input = z
        .object({
          category: z.enum(["copyright", "inappropriate", "spam", "other"]),
          details: z.string().trim().max(500).default(""),
        })
        .strict()
        .parse(request.body);
      const video = await VideoModel.findOne({
        _id: videoId,
        status: "approved",
      })
        .select("creatorId")
        .lean();
      if (!video) {
        throw new HttpError(404, "VIDEO_NOT_FOUND", "This video was not found.");
      }
      if (video.creatorId.toString() === user.id) {
        throw new HttpError(400, "INVALID_REPORT", "You cannot report your own video.");
      }
      await VideoReportModel.create({
        videoId: video._id,
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

videosRouter.post("/", requireAuth, videoUploadRateLimit, videoUpload.single("file"), async (request, response, next) => {
  try {
    const user = request.user;
    if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to upload.");
    if (!request.file) {
      throw new HttpError(400, "VIDEO_FILE_REQUIRED", "Choose a video file to upload.");
    }
    const input = videoInputSchema.parse(request.body);
    await validateVideoFileSignature(
      request.file.path,
      request.file.originalname,
    );
    const asset = await uploadVideoFile(request.file.path);
    const video = await VideoModel.create({
      publicId: asset.public_id,
      title: input.title,
      description: input.description,
      playbackUrl: asset.secure_url,
      thumbnailUrl: asset.secure_url.replace(
        "/video/upload/",
        "/video/upload/so_0/",
      ).replace(/\.[^/.]+$/, ".jpg"),
      duration: asset.duration,
      bytes: asset.bytes,
      creatorId: new Types.ObjectId(user.id),
      status: "pending",
      moderationNote: null,
    });
    const populated = await VideoModel.findById(video._id)
      .populate("creatorId", "displayName username")
      .lean();
    if (!populated) {
      throw new HttpError(500, "VIDEO_SAVE_FAILED", "The video could not be loaded.");
    }
    response.status(201).json({ video: videoResponse(populated) });
  } catch (error) {
    next(error);
  } finally {
    if (request.file) {
      try {
        await unlink(request.file.path);
      } catch (error) {
        console.error("Could not remove temporary video upload", error);
      }
    }
  }
});

videosRouter.get("/creator", requireAuth, async (request, response, next) => {
  try {
    const user = request.user;
    if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to view your videos.");
    const videos = await VideoModel.find({ creatorId: user.id })
      .sort({ createdAt: -1 })
      .populate("creatorId", "displayName username")
      .lean();
    response.status(200).json({ videos: videos.map(videoResponse) });
  } catch (error) {
    next(error);
  }
});

videosRouter.get("/admin", requireAuth, async (request, response, next) => {
  try {
    requireAdmin(request);
    const videos = await VideoModel.find({ status: "pending" })
      .sort({ createdAt: 1 })
      .limit(100)
      .populate("creatorId", "displayName username")
      .lean();
    response.status(200).json({ videos: videos.map(videoResponse) });
  } catch (error) {
    next(error);
  }
});

videosRouter.get(
  "/admin/reports",
  requireAuth,
  async (request, response, next) => {
    try {
      requireAdmin(request);
      const reports = await VideoReportModel.find({ status: "open" })
        .sort({ createdAt: 1 })
        .limit(100)
        .populate({
          path: "videoId",
          select: "title playbackUrl creatorId",
          populate: { path: "creatorId", select: "displayName username" },
        })
        .populate("reporterId", "displayName username")
        .lean();
      response.status(200).json({ reports });
    } catch (error) {
      next(error);
    }
  },
);

videosRouter.patch(
  "/admin/reports/:reportId",
  requireAuth,
  async (request, response, next) => {
    try {
      requireAdmin(request);
      const { reportId } = z
        .object({ reportId: z.string().refine(Types.ObjectId.isValid) })
        .parse(request.params);
      const input = z
        .object({
          status: z.enum(["resolved", "dismissed"]),
          moderatorNote: z.string().trim().max(500).default(""),
        })
        .strict()
        .parse(request.body);
      const actor = request.user;
      if (!actor) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
      const openReport = await VideoReportModel.findOne({
        _id: reportId,
        status: "open",
      }).select("_id").lean();
      if (!openReport) {
        throw new HttpError(404, "REPORT_NOT_FOUND", "This open report was not found.");
      }
      await writeAdminAudit({
        actorId: actor.id,
        action: "video-report.resolved",
        targetType: "video-report",
        targetId: new Types.ObjectId(reportId),
        details: { status: input.status, moderatorNote: input.moderatorNote },
      });
      const report = await VideoReportModel.findByIdAndUpdate(
        reportId,
        { $set: input },
        { new: true, runValidators: true },
      ).lean();
      if (!report) {
        throw new HttpError(404, "REPORT_NOT_FOUND", "This report was not found.");
      }
      response.status(200).json({ report });
    } catch (error) {
      next(error);
    }
  },
);

videosRouter.patch(
  "/admin/:videoId",
  requireAuth,
  async (request, response, next) => {
    try {
      requireAdmin(request);
      const { videoId } = z
        .object({ videoId: z.string().refine(Types.ObjectId.isValid) })
        .parse(request.params);
      const input = z
        .object({
          status: z.enum(["approved", "rejected"]),
          moderationNote: z.string().trim().max(500).default(""),
        })
        .strict()
        .parse(request.body);
      if (input.status === "rejected" && input.moderationNote.length < 5) {
        throw new HttpError(
          400,
          "MODERATION_NOTE_REQUIRED",
          "Add a short reason when rejecting a video.",
        );
      }

      const actor = request.user;
      if (!actor) throw new HttpError(401, "UNAUTHENTICATED", "Sign in to continue.");
      const existing = await VideoModel.findById(videoId).select("status").lean();
      if (!existing) {
        throw new HttpError(404, "VIDEO_NOT_FOUND", "This video was not found.");
      }
      await writeAdminAudit({
        actorId: actor.id,
        action: "video.moderated",
        targetType: "video",
        targetId: new Types.ObjectId(videoId),
        details: {
          previousStatus: existing.status,
          status: input.status,
          moderationNote: input.moderationNote,
        },
      });
      const video = await VideoModel.findByIdAndUpdate(
        videoId,
        {
          $set: {
            status: input.status,
            moderationNote:
              input.status === "rejected" ? input.moderationNote : null,
          },
        },
        { new: true, runValidators: true },
      )
        .populate("creatorId", "displayName username")
        .lean();
      if (!video) {
        throw new HttpError(404, "VIDEO_NOT_FOUND", "This video was not found.");
      }
      response.status(200).json({ video: videoResponse(video) });
    } catch (error) {
      next(error);
    }
  },
);
