import "dotenv/config";
import { z } from "zod";

const optionalValue = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().positive().default(4000),
    WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
    MONGODB_URI: optionalValue,
    FIREBASE_PROJECT_ID: optionalValue,
    FIREBASE_CLIENT_EMAIL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().email().optional(),
    ),
    FIREBASE_PRIVATE_KEY: optionalValue,
    CLOUDINARY_CLOUD_NAME: optionalValue,
    CLOUDINARY_API_KEY: optionalValue,
    CLOUDINARY_API_SECRET: optionalValue,
    FOOTBALL_API_KEY: optionalValue,
    STRIPE_SECRET_KEY: optionalValue,
    FOOTBALL_API_BASE_URL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().default("https://v3.football.api-sports.io"),
    ),
  })
  .superRefine((configuration, context) => {
    if (configuration.NODE_ENV !== "production") return;
    if (!process.env.WEB_ORIGIN?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["WEB_ORIGIN"],
        message: "WEB_ORIGIN must be explicitly configured in production.",
      });
      return;
    }
    if (new URL(configuration.WEB_ORIGIN).protocol !== "https:") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["WEB_ORIGIN"],
        message: "WEB_ORIGIN must use HTTPS in production.",
      });
    }
  });

export const env = envSchema.parse(process.env);

export const isFirebaseConfigured = Boolean(
  env.FIREBASE_PROJECT_ID &&
    env.FIREBASE_CLIENT_EMAIL &&
    env.FIREBASE_PRIVATE_KEY,
);

export const isFootballApiConfigured = Boolean(env.FOOTBALL_API_KEY);
export const isStripeConfigured = Boolean(env.STRIPE_SECRET_KEY);
export const isCloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET,
);
