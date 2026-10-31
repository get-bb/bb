import { describe, expect, it, vi } from "vitest";
import {
  fetchServerHealth,
  isServerMoveReady,
  serverHealthUrl,
} from "../src/index.js";

describe("serverHealthUrl", () => {
  it.each([
    ["https://desk.example", "https://desk.example/health"],
    ["https://desk.example/", "https://desk.example/health"],
    ["https://proxy.example/bb", "https://proxy.example/bb/health"],
    ["https://proxy.example/bb//", "https://proxy.example/bb/health"],
  ])("resolves %s to %s", (serverUrl, healthUrl) => {
    expect(serverHealthUrl(serverUrl)).toBe(healthUrl);
  });
});

describe("fetchServerHealth", () => {
  const url = "https://desk.example/health";

  it("reads a bb server's health answer with the caller's request options", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        ok: true,
        launchId: "launch-1",
        serverMove: { moveId: "move-1", state: "activating" },
      }),
    );
    const init = { cache: "no-store" as const };

    await expect(fetchServerHealth({ fetchImpl, init, url })).resolves.toEqual({
      ok: true,
      serverMove: { moveId: "move-1", state: "activating" },
    });
    expect(fetchImpl).toHaveBeenCalledWith(url, init);
  });

  it.each([
    ["a service without ok: true", async () => Response.json({ status: "up" })],
    [
      "an error status",
      async () => Response.json({ ok: true }, { status: 503 }),
    ],
    ["a non-JSON answer", async () => new Response("<html>")],
    [
      "an unknown move state",
      async () =>
        Response.json({
          ok: true,
          serverMove: { moveId: "move-1", state: "booting" },
        }),
    ],
    [
      "an unreachable server",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("answers null for %s", async (_label, respond) => {
    await expect(
      fetchServerHealth({ fetchImpl: vi.fn(respond), init: {}, url }),
    ).resolves.toBeNull();
  });
});

describe("isServerMoveReady", () => {
  it.each([
    [null, false],
    [{ moveId: "move-1", state: "pending" as const }, false],
    [{ moveId: "move-1", state: "activating" as const }, false],
    [{ moveId: "move-0", state: "ready" as const }, false],
    [{ moveId: "move-1", state: "ready" as const }, true],
  ])("treats %j as ready=%s for move-1", (serverMove, ready) => {
    expect(isServerMoveReady(serverMove, "move-1")).toBe(ready);
  });
});
