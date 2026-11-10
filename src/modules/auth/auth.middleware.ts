import type { RequestHandler } from "express";
import { createHash } from "node:crypto";
import { isDatabaseConnected } from "../../database/connection";
import { UserModel, type UserRecord } from "../../database/models/user.model";
import { getFirebaseAuth } from "../../integrations/firebase/firebase-admin";
import {
  HttpError,
  ServiceUnavailableError,
} from "../../shared/http-error";

const invalidTokenCodes = new Set([
  "auth/argument-error",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/invalid-id-token",
  "auth/user-disabled",
]);

interface AuthClaims {
  uid: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  name?: string;
}

interface AuthUser extends UserRecord {
  _id: { toString(): string };
}

interface AuthDependencies {
  isDatabaseConnected(): boolean;
  verifyIdToken(token: string): Promise<AuthClaims>;
  findOrCreateUser(claims: AuthClaims): Promise<AuthUser | null>;
}

const defaultDependencies: AuthDependencies = {
  isDatabaseConnected,
  verifyIdToken: (token) => getFirebaseAuth().verifyIdToken(token, true),
  async findOrCreateUser(claims) {
    return UserModel.findOneAndUpdate(
      { firebaseUid: claims.uid },
      {
        $set: {
          email: claims.email ?? null,
          emailVerified: claims.email_verified ?? false,
          photoUrl: claims.picture ?? null,
          displayName: claims.name ?? null,
        },
        $setOnInsert: {
          firebaseUid: claims.uid,
          username: `fan_${createHash("sha256")
            .update(claims.uid)
            .digest("hex")
            .slice(0, 20)}`,
          role: "user",
          status: "active",
        },
      },
      { new: true, upsert: true, runValidators: true },
    ).lean();
  },
};

export function createRequireAuth(
  dependencies: AuthDependencies = defaultDependencies,
): RequestHandler {
  return async (request, _response, next) => {
    try {
      const authorization = request.header("authorization");
      const match = authorization?.match(/^Bearer\s+(\S+)$/i);
      if (!match) {
        throw new HttpError(401, "UNAUTHENTICATED", "A bearer token is required.");
      }

      if (!dependencies.isDatabaseConnected()) {
        throw new ServiceUnavailableError("The user database is unavailable.");
      }

      let claims: AuthClaims;
      try {
        claims = await dependencies.verifyIdToken(match[1]);
      } catch (error) {
        const code =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : undefined;

        if (code && invalidTokenCodes.has(code)) {
          throw new HttpError(
            401,
            "INVALID_TOKEN",
            "The authentication token is invalid or expired.",
          );
        }
        if (error instanceof ServiceUnavailableError) throw error;
        console.error("Firebase token verification failed", error);
        throw new ServiceUnavailableError("Authentication could not be verified.");
      }

      const account = await dependencies.findOrCreateUser(claims);
      if (!account) {
        throw new ServiceUnavailableError("The user profile could not be loaded.");
      }
      if (account.status !== "active") {
        throw new HttpError(403, "ACCOUNT_SUSPENDED", "This account is suspended.");
      }

      request.user = { ...account, id: account._id.toString() };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAuth = createRequireAuth();
