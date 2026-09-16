import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchServerMoveDestinationHealth } from "./server-move-destination";

const URL = "https://desk.example.com/health";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchServerMoveDestinationHealth", () => {
  it("reads the move state from the destination's health answer without credentials", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            serverMove: { moveId: "move_1", state: "ready" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(
      fetchServerMoveDestinationHealth(URL, controller.signal),
    ).resolves.toEqual({ moveId: "move_1", state: "ready" });
    expect(fetchMock).toHaveBeenCalledWith(URL, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
  });

  it.each([
    [
      "a health answer without a move",
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ],
    [
      "an error status",
      async () => new Response("unavailable", { status: 503 }),
    ],
    ["a malformed answer", async () => new Response("<html>", { status: 200 })],
    [
      "an unreachable destination",
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("answers null for %s", async (_label, respond) => {
    vi.stubGlobal("fetch", vi.fn(respond));

    await expect(
      fetchServerMoveDestinationHealth(URL, new AbortController().signal),
    ).resolves.toBeNull();
  });
});
