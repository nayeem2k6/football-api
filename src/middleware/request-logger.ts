import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const requestLogger: RequestHandler = (request, response, next) => {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();
  response.setHeader("X-Request-Id", requestId);
  response.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: response.statusCode >= 500 ? "error" : "info",
        message: "http_request",
        requestId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  });
  next();
};
