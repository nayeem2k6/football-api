import { app } from "./app";
import { env } from "./config/env";
import { connectToDatabase } from "./database/connection";
import mongoose from "mongoose";

async function start(): Promise<void> {
  if (env.MONGODB_URI) {
    await connectToDatabase(env.MONGODB_URI);
  } else {
    console.error(
      "MONGODB_URI is not configured; data-dependent endpoints will remain unavailable.",
    );
  }

  const server = app.listen(env.API_PORT, () => {
    console.log(`Football Platform API listening on port ${env.API_PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received; closing HTTP server`);
    server.close((error) => {
      if (error) {
        console.error("Failed to close HTTP server cleanly", error);
        process.exitCode = 1;
      }
      void mongoose.disconnect().catch((disconnectError: unknown) => {
        console.error("Failed to disconnect from MongoDB cleanly", disconnectError);
        process.exitCode = 1;
      });
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error: unknown) => {
  console.error("API startup failed", error);
  process.exitCode = 1;
});
