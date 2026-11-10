import {
  env,
  isCloudinaryConfigured,
  isFirebaseConfigured,
  isFootballApiConfigured,
  isStripeConfigured,
} from "../config/env";
import { isDatabaseConnected } from "../database/connection";

export function getReadiness() {
  const dependencies = {
    database: isDatabaseConnected() ? "ready" : "unavailable",
    authentication: isFirebaseConfigured ? "configured" : "unconfigured",
  } as const;
  const ready =
    dependencies.database === "ready" &&
    dependencies.authentication === "configured";

  return {
    status: ready ? "ready" : "not_ready",
    service: "football-platform-api",
    dependencies,
    integrations: {
      footballData: isFootballApiConfigured ? "configured" : "unconfigured",
      videoHosting: isCloudinaryConfigured ? "configured" : "unconfigured",
      stripeConnect: isStripeConfigured ? "configured" : "unconfigured",
    },
    configuration: {
      databaseUriProvided: Boolean(env.MONGODB_URI),
    },
    timestamp: new Date().toISOString(),
  };
}
