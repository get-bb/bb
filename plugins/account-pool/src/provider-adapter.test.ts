import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  fetchOAuthRefresh,
  parseOAuthRefreshResponse,
  TransientOAuthRefreshError,
} from "./provider-adapter.js";

describe("OAuth refresh transport", () => {
  it.each([
    {
      body: {
        error: "invalid_grant",
        error_description: "Refresh token expired",
      },
      detail: " invalid_grant: Refresh token expired.",
    },
    {
      body: {
        error: "invalid_grant",
        error_description: "refresh-secret access-secret",
      },
      detail: " invalid_grant.",
    },
    {
      body: {
        error: { code: "refresh_token_reused", message: "refresh-secret" },
      },
      detail: " refresh_token_reused.",
    },
    {
      body: { error: "refresh-secret", error_description: "access-secret" },
      detail: "",
    },
  ])(
    "retains only recognized OAuth error details: $detail",
    async ({ body, detail }) => {
      await expect(
        fetchOAuthRefresh(
          {
            fetch: async () => Response.json(body, { status: 400 }),
            now: () => 0,
          },
          "https://auth.example/token",
          { refresh_token: "refresh-secret" },
        ),
      ).rejects.toMatchObject({
        message: `OAuth refresh failed with HTTP 400.${detail}`,
      });
    },
  );

  it.each(["malformed", "oversized", "broken", "pending"])(
    "preserves HTTP rejection classification with a %s JSON error body",
    async (body) => {
      const controller = new AbortController();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(controller.signal);
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      try {
        const stream = new ReadableStream<Uint8Array>({
          start(streamController) {
            if (body === "broken")
              streamController.error(new Error("private socket detail"));
            else if (body !== "pending") {
              streamController.enqueue(
                new TextEncoder().encode(
                  body === "malformed"
                    ? "{"
                    : JSON.stringify({
                        error: "invalid_grant",
                        padding: "x".repeat(4096),
                      }),
                ),
              );
              streamController.close();
            }
          },
          cancel,
        });
        const refresh = fetchOAuthRefresh(
          {
            fetch: async () =>
              new Response(stream, {
                status: 400,
                headers: { "content-type": "application/json" },
              }),
            now: () => 0,
          },
          "https://auth.example/token",
          { refresh_token: "refresh-secret" },
        );
        if (body === "pending") {
          await new Promise<void>((resolve) => setImmediate(resolve));
          controller.abort(new DOMException("Timed out", "TimeoutError"));
        }
        await expect(refresh).rejects.toMatchObject({
          message: "OAuth refresh failed with HTTP 400.",
        });
        await expect(refresh).rejects.not.toBeInstanceOf(
          TransientOAuthRefreshError,
        );
        if (body === "pending") expect(cancel).toHaveBeenCalledOnce();
      } finally {
        timeout.mockRestore();
      }
    },
  );

  it("classifies rejected JSON responses even when the body and cancellation never settle", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    await expect(
      fetchOAuthRefresh(
        {
          fetch: async () =>
            new Response(new ReadableStream({ cancel }), {
              status: 503,
              headers: { "content-type": "application/json" },
            }),
          now: () => 0,
        },
        "https://auth.example/token",
        { refresh_token: "refresh" },
      ),
    ).rejects.toBeInstanceOf(TransientOAuthRefreshError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["request", "body"])(
    "bounds a %s transport that ignores abort",
    async (stage) => {
      const controller = new AbortController();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(controller.signal);
      try {
        const refresh = fetchOAuthRefresh(
          {
            fetch: async () =>
              stage === "request"
                ? new Promise<Response>(() => {})
                : new Response(new ReadableStream()),
            now: () => 0,
          },
          "https://auth.example/token",
          { refresh_token: "refresh" },
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        controller.abort(
          new DOMException("OAuth request timed out", "TimeoutError"),
        );
        await expect(refresh).rejects.toBeInstanceOf(
          TransientOAuthRefreshError,
        );
      } finally {
        timeout.mockRestore();
      }
    },
  );

  it.each([
    { status: 400, transient: false },
    { status: 401, transient: false },
    { status: 403, transient: true },
    { status: 404, transient: true },
    { status: 408, transient: true },
    { status: 429, transient: true },
    { status: 500, transient: true },
    { status: 503, transient: true },
  ])(
    "cancels HTTP $status responses before classifying them",
    async ({ status, transient }) => {
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({ cancel }), {
        status,
        headers: { "retry-after": "120" },
      });
      const refresh = fetchOAuthRefresh(
        { fetch: async () => response, now: () => 1_800_000_000_000 },
        "https://auth.example/token",
        { refresh_token: "refresh" },
      );
      await expect(refresh).rejects.toThrow(
        `OAuth refresh failed with HTTP ${status}.`,
      );
      if (transient) {
        await expect(refresh).rejects.toBeInstanceOf(
          TransientOAuthRefreshError,
        );
        await expect(refresh).rejects.toMatchObject({ retryAfterMs: 120_000 });
      } else {
        await expect(refresh).rejects.not.toBeInstanceOf(
          TransientOAuthRefreshError,
        );
      }
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["request", "response"])(
    "classifies a broken %s connection as transient",
    async (stage) => {
      const refresh = fetchOAuthRefresh(
        {
          fetch: async () => {
            if (stage === "request") throw new TypeError("fetch failed");
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new TypeError("socket closed"));
                },
              }),
            );
          },
          now: () => 1_800_000_000_000,
        },
        "https://auth.example/token",
        { refresh_token: "refresh" },
      );
      await expect(refresh).rejects.toBeInstanceOf(TransientOAuthRefreshError);
    },
  );

  it.each(["<html>Service unavailable</html>", '{"token_type":"bearer"}'])(
    "classifies an unreadable successful refresh body as transient: %s",
    (text) => {
      expect(() =>
        parseOAuthRefreshResponse(
          text,
          z.object({ access_token: z.string().min(1) }),
        ),
      ).toThrow(TransientOAuthRefreshError);
    },
  );

  it("times out a pending OAuth request independently of its callers", async () => {
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    try {
      const refresh = fetchOAuthRefresh(
        {
          fetch: async (_input, init) => {
            const signal = init?.signal;
            if (signal === null || signal === undefined)
              return Response.json({});
            return new Promise<Response>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
            });
          },
          now: () => 1_800_000_000_000,
        },
        "https://auth.example/token",
        { refresh_token: "refresh" },
      );
      controller.abort(
        new DOMException("OAuth request timed out", "TimeoutError"),
      );
      await expect(refresh).rejects.toBeInstanceOf(TransientOAuthRefreshError);
      expect(timeout).toHaveBeenCalledWith(15_000);
    } finally {
      timeout.mockRestore();
    }
  });
});
