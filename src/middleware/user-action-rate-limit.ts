import { rateLimit } from "express-rate-limit";
import { env } from "../config/env";
import { MongoRateLimitStore } from "./mongo-rate-limit-store";

function createUserActionRateLimit(options: {
  namespace: string;
  windowMs: number;
  limit: number;
  code: string;
  message: string;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    ...(env.NODE_ENV === "production"
      ? { store: new MongoRateLimitStore(options.namespace) }
      : {}),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (request) =>
      request.user?.id ?? request.ip ?? "",
    handler: (_request, response) => {
      response.status(429).json({
        error: { code: options.code, message: options.message },
      });
    },
  });
}

export const commentRateLimit = createUserActionRateLimit({
  namespace: "comment",
  windowMs: 10 * 60 * 1000,
  limit: 10,
  code: "COMMENT_RATE_LIMITED",
  message: "Too many comments. Please wait before posting again.",
});

export const reactionRateLimit = createUserActionRateLimit({
  namespace: "reaction",
  windowMs: 60 * 1000,
  limit: 60,
  code: "REACTION_RATE_LIMITED",
  message: "Too many reactions. Please wait before trying again.",
});

export const socialReportRateLimit = createUserActionRateLimit({
  namespace: "social-report",
  windowMs: 60 * 60 * 1000,
  limit: 5,
  code: "REPORT_RATE_LIMITED",
  message: "Too many reports. Please try again later.",
});

export const videoUploadRateLimit = createUserActionRateLimit({
  namespace: "video-upload",
  windowMs: 60 * 60 * 1000,
  limit: 5,
  code: "UPLOAD_RATE_LIMITED",
  message: "Too many video uploads. Please try again later.",
});
