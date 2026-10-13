import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { ApiError, createServerErrorHandler } from "./errors.js";

function createApp(error: ApiError) {
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const app = new Hono();
  app.onError(createServerErrorHandler(logger));
  app.post("/api/v1/threads/:threadId/messages", () => {
    throw error;
  });
  return { app, logger };
}

describe("createServerErrorHandler", () => {
  it("logs deliberate 5xx API errors with the failing request", async () => {
    const error = new ApiError(500, "internal_error", "Thread changed twice");
    const { app, logger } = createApp(error);

    const response = await app.request("/api/v1/threads/thr_x/messages", {
      method: "POST",
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "internal_error",
      message: "Thread changed twice",
    });
    expect(logger.error).toHaveBeenCalledWith(
      {
        err: error,
        method: "POST",
        path: "/api/v1/threads/thr_x/messages",
        status: 500,
        body: { code: "internal_error", message: "Thread changed twice" },
      },
      "Server error response",
    );
  });

  it("does not log client errors", async () => {
    const { app, logger } = createApp(
      new ApiError(404, "thread_not_found", "Thread not found"),
    );

    const response = await app.request("/api/v1/threads/thr_x/messages", {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
