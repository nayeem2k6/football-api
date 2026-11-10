import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { getReadiness } from "./health/readiness";
import { apiRateLimit } from "./middleware/api-rate-limit";
import { errorHandler } from "./middleware/error-handler";
import { requestLogger } from "./middleware/request-logger";
import { notFoundHandler } from "./middleware/not-found";
import { adminRouter } from "./modules/admin/admin.routes";
import { footballRateLimit } from "./modules/football/football-rate-limit";
import { footballRouter } from "./modules/football/football.routes";
import { creatorRouter } from "./modules/creator/creator.routes";
import { newsRouter } from "./modules/news/news.routes";
import { socialRouter } from "./modules/social/social.routes";
import { meRouter } from "./modules/users/users.routes";
import { videosRouter } from "./modules/videos/videos.routes";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(requestLogger);
app.use(
  cors({
    origin:
      env.NODE_ENV === "development"
        ? [env.WEB_ORIGIN, "http://localhost:3000"]
        : env.WEB_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  }),
);
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "football-platform-api",
    timestamp: new Date().toISOString(),
  });
});

app.get("/ready", (_request, response) => {
  const readiness = getReadiness();
  response.status(readiness.status === "ready" ? 200 : 503).json(readiness);
});

app.use("/api/v1", apiRateLimit);
app.use("/api/v1", meRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/football", footballRateLimit, footballRouter);
app.use("/api/v1/news", newsRouter);
app.use("/api/v1/social", socialRouter);
app.use("/api/v1/creator", creatorRouter);
app.use("/api/v1/videos", videosRouter);

app.use(notFoundHandler);
app.use(errorHandler);
