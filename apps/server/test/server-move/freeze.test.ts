import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { errorToResponse } from "../../src/errors.js";
import { serverMoveFreezeMiddleware } from "../../src/services/server-move/freeze.js";
import { readJson } from "../helpers/json.js";
import { testLogger } from "../helpers/test-app.js";

function frozenApp(state: { frozen: boolean }): Hono {
  const app = new Hono();
  app.onError((error) => errorToResponse(error, testLogger));
  app.use(
    "/api/v1/*",
    serverMoveFreezeMiddleware({ isFrozen: () => state.frozen }),
  );
  app.all("/api/v1/*", (context) => context.json({ ok: true }));
  app.all("/internal/*", (context) => context.json({ ok: true }));
  return app;
}

describe("server move freeze middleware", () => {
  it("blocks public writes while frozen and keeps reads, move routes, and daemon routes open", async () => {
    const state = { frozen: true };
    const app = frozenApp(state);

    for (const [method, path] of [
      ["POST", "/api/v1/threads"],
      ["PATCH", "/api/v1/hosts/host-1"],
      ["DELETE", "/api/v1/projects/project-1"],
      ["POST", "/api/v1/server/export"],
      ["POST", "/api/v1/server/movement"],
    ] as const) {
      const response = await app.request(path, { method });
      expect(response.status, `${method} ${path}`).toBe(503);
      expect(await readJson(response)).toEqual({
        code: "server_moving",
        message:
          "The server is moving to another machine. Changes are paused until the move finishes or is cancelled.",
        retryable: false,
      });
    }
    for (const [method, path] of [
      ["GET", "/api/v1/threads"],
      ["HEAD", "/api/v1/threads"],
      ["POST", "/api/v1/server/move"],
      ["POST", "/api/v1/server/move/check"],
      ["POST", "/api/v1/server/move/cancel"],
      ["POST", "/internal/events"],
    ] as const) {
      const response = await app.request(path, { method });
      expect(response.status, `${method} ${path}`).toBe(200);
    }

    state.frozen = false;
    expect(
      (await app.request("/api/v1/threads", { method: "POST" })).status,
    ).toBe(200);
  });
});
