import { app } from "./app";
import { env } from "./config/env";

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
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
