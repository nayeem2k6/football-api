import type { ErrorRequestHandler } from "express";
import multer from "multer";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { HttpError } from "../shared/http-error";

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    response.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_UPLOAD",
        message: tooLarge
          ? "Videos must be 100 MB or smaller."
          : "The video upload request is invalid.",
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "INVALID_REQUEST",
        message: "The request is invalid.",
        details: error.issues.map(({ path, message }) => ({
          path: path.join("."),
          message,
        })),
      },
    });
    return;
  }

  if (error instanceof mongoose.Error.ValidationError) {
    response.status(400).json({
      error: {
        code: "INVALID_DATA",
        message: "The submitted data is invalid.",
      },
    });
    return;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  ) {
    response.status(409).json({
      error: {
        code: "CONFLICT",
        message: "A record with the same unique value already exists.",
      },
    });
    return;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
  ) {
    response.status(error.status).json({
      error: {
        code: error.status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST",
        message:
          error.status === 413
            ? "The request body is too large."
            : "The request is invalid.",
      },
    });
    return;
  }

  console.error("Unhandled API error", error);
  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    },
  });
};
