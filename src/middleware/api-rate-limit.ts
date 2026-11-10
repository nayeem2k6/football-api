import { rateLimit } from "express-rate-limit";
import { env } from "../config/env";
import { MongoRateLimitStore } from "./mongo-rate-limit-store";

export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  ...(env.NODE_ENV === "production"
    ? { store: new MongoRateLimitStore("api") }
    : {}),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
      },
    });
  },
});
