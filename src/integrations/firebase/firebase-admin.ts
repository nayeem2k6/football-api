import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { env, isFirebaseConfigured } from "../../config/env";
import { ServiceUnavailableError } from "../../shared/http-error";

let firebaseAuth: Auth | undefined;

export function getFirebaseAuth(): Auth {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } =
    env;
  if (
    !isFirebaseConfigured ||
    !FIREBASE_PROJECT_ID ||
    !FIREBASE_CLIENT_EMAIL ||
    !FIREBASE_PRIVATE_KEY
  ) {
    throw new ServiceUnavailableError(
      "Firebase Authentication is not configured.",
    );
  }

  if (!firebaseAuth) {
    const app =
      getApps()[0] ??
      initializeApp({
        credential: cert({
          projectId: FIREBASE_PROJECT_ID,
          clientEmail: FIREBASE_CLIENT_EMAIL,
          privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
      });
    firebaseAuth = getAuth(app);
  }

  return firebaseAuth;
}
