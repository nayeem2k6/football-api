import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { Types } from "mongoose";
import { describe, it } from "node:test";
import { errorHandler } from "../src/middleware/error-handler";
import { requestLogger } from "../src/middleware/request-logger";
import { commentRateLimit } from "../src/middleware/user-action-rate-limit";
import { adminRouter } from "../src/modules/admin/admin.routes";
import { createRequireAuth } from "../src/modules/auth/auth.middleware";
import { creatorRouter } from "../src/modules/creator/creator.routes";
import { socialRouter } from "../src/modules/social/social.routes";

const activeAccount = {
  _id: new Types.ObjectId(),
  firebaseUid: "test-user",
  username: "test_user",
  email: null,
  emailVerified: false,
  displayName: "Test User",
  photoUrl: null,
  bio: "",
  stripeConnectAccountId: null,
  role: "user" as const,
  status: "active" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function withServer(
  configure: (app: express.Express) => void,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  configure(app);
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("authenticated API behavior", () => {
  it("rejects missing bearer credentials on admin and comment-report endpoints", async () => {
    await withServer((app) => {
      app.use("/admin", adminRouter);
      app.use("/social", socialRouter);
      app.use("/creator", creatorRouter);
    }, async (baseUrl) => {
      const adminResponse = await fetch(`${baseUrl}/admin/users`);
      const reportResponse = await fetch(
        `${baseUrl}/social/comments/${new Types.ObjectId()}/reports`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      assert.equal(adminResponse.status, 401);
      assert.equal(reportResponse.status, 401);
      assert.equal((await adminResponse.json()).error.code, "UNAUTHENTICATED");

      const protectedPaths = [
        `/social/video/${new Types.ObjectId()}/like`,
        `/social/video/${new Types.ObjectId()}/comments`,
        `/creator/monetization`,
        `/creator/monetization/connect`,
      ];
      for (const path of protectedPaths) {
        const response = await fetch(`${baseUrl}${path}`, {
          method: path.endsWith("/comments") || path.endsWith("/connect") ? "POST" : "GET",
          headers: { "content-type": "application/json" },
          body: path.endsWith("/comments") || path.endsWith("/connect") ? "{}" : undefined,
        });
        assert.equal(response.status, 401, path);
      }
    });
  });

  it("returns 503 without calling Firebase when MongoDB is unavailable", async () => {
    let verifyCalls = 0;
    await withServer((app) => {
      app.get(
        "/protected",
        createRequireAuth({
          isDatabaseConnected: () => false,
          verifyIdToken: async () => {
            verifyCalls += 1;
            return { uid: "test-user" };
          },
          findOrCreateUser: async () => activeAccount,
        }),
        (_request, response) => response.sendStatus(204),
      );
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: { authorization: "Bearer token" },
      });
      assert.equal(response.status, 503);
      assert.equal(verifyCalls, 0);
    });
  });

  it("maps Firebase invalid-token and provider-outage failures to explicit responses", async () => {
    const invalidToken = Object.assign(new Error("expired"), {
      code: "auth/id-token-expired",
    });
    await withServer((app) => {
      app.get(
        "/invalid",
        createRequireAuth({
          isDatabaseConnected: () => true,
          verifyIdToken: async () => {
            throw invalidToken;
          },
          findOrCreateUser: async () => activeAccount,
        }),
        (_request, response) => response.sendStatus(204),
      );
      app.get(
        "/outage",
        createRequireAuth({
          isDatabaseConnected: () => true,
          verifyIdToken: async () => {
            throw new Error("firebase unavailable");
          },
          findOrCreateUser: async () => activeAccount,
        }),
        (_request, response) => response.sendStatus(204),
      );
    }, async (baseUrl) => {
      const originalConsoleError = console.error;
      console.error = () => undefined;
      try {
        const invalid = await fetch(`${baseUrl}/invalid`, {
          headers: { authorization: "Bearer token" },
        });
        const outage = await fetch(`${baseUrl}/outage`, {
          headers: { authorization: "Bearer token" },
        });
        assert.equal(invalid.status, 401);
        assert.equal(outage.status, 503);
      } finally {
        console.error = originalConsoleError;
      }
    });
  });

  it("blocks suspended users and allows active users", async () => {
    await withServer((app) => {
      app.get(
        "/suspended",
        createRequireAuth({
          isDatabaseConnected: () => true,
          verifyIdToken: async () => ({ uid: "suspended-user" }),
          findOrCreateUser: async () => ({ ...activeAccount, status: "suspended" }),
        }),
        (_request, response) => response.sendStatus(204),
      );
      app.get(
        "/active",
        createRequireAuth({
          isDatabaseConnected: () => true,
          verifyIdToken: async () => ({ uid: "test-user" }),
          findOrCreateUser: async () => activeAccount,
        }),
        (request, response) => response.status(200).json({ userId: request.user?.id }),
      );
    }, async (baseUrl) => {
      const suspended = await fetch(`${baseUrl}/suspended`, {
        headers: { authorization: "Bearer token" },
      });
      const active = await fetch(`${baseUrl}/active`, {
        headers: { authorization: "Bearer token" },
      });
      assert.equal(suspended.status, 403);
      assert.equal(active.status, 200);
      assert.equal((await active.json()).userId, activeAccount._id.toString());
    });
  });

  it("rate-limits repeated user actions", async () => {
    await withServer((app) => {
      app.use((request, _response, next) => {
        request.user = { ...activeAccount, id: activeAccount._id.toString() };
        next();
      });
      app.post("/comment", commentRateLimit, (_request, response) => {
        response.sendStatus(204);
      });
    }, async (baseUrl) => {
      const statuses: number[] = [];
      for (let index = 0; index < 11; index += 1) {
        statuses.push((await fetch(`${baseUrl}/comment`, { method: "POST" })).status);
      }
      assert.deepEqual(statuses.slice(0, 10), Array(10).fill(204));
      assert.equal(statuses[10], 429);
    });
  });

  it("adds a request ID and emits a structured completion log", async () => {
    await withServer((app) => {
      app.use(requestLogger);
      app.get("/health-check", (_request, response) => response.sendStatus(204));
    }, async (baseUrl) => {
      const logLines: string[] = [];
      const originalConsoleLog = console.log;
      console.log = (line) => logLines.push(String(line));
      try {
        const response = await fetch(`${baseUrl}/health-check?token=must-not-be-logged`);
        const requestId = response.headers.get("x-request-id");
        assert.match(requestId ?? "", /^[0-9a-f-]{36}$/);
        assert.equal(response.status, 204);
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        console.log = originalConsoleLog;
      }
      assert.equal(logLines.length, 1);
      assert.equal(logLines[0].includes("must-not-be-logged"), false);
      assert.equal(JSON.parse(logLines[0]).message, "http_request");
    });
  });
});
