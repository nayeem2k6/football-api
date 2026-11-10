import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env";
import { MongoRateLimitStore } from "../../middleware/mongo-rate-limit-store";

export const footballRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 30,
  ...(env.NODE_ENV === "production"
    ? { store: new MongoRateLimitStore("football") }
    : {}),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many football data requests. Please try again shortly.",
    },
  },
});
