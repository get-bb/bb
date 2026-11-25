import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  orderServerRoutes,
  probeServerRoute,
  selectServerRoute,
  type ServerRouteFetch,
} from "../src/index.js";

interface RouteBehavior {
  answer: boolean;
  delayMs: number;
}

function probeAfter(behavior: Record<string, RouteBehavior>) {
  return (route: string, signal: AbortSignal) =>
    new Promise<boolean>((resolve) => {
      const { answer, delayMs } = behavior[route] ?? {
        answer: false,
        delayMs: 0,
      };
      const timer = setTimeout(() => resolve(answer), delayMs);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
}

describe("selectServerRoute", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function settle<T>(work: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(4_000);
    return work;
  }

  it("lets a better-ranked route win when it answers within its head start", async () => {
    const selected = selectServerRoute(
      ["lan", "tailnet", "relay"],
      probeAfter({
        lan: { answer: true, delayMs: 400 },
        tailnet: { answer: true, delayMs: 10 },
        relay: { answer: true, delayMs: 10 },
      }),
    );
    expect(await settle(selected)).toBe("lan");
  });

  it("does not wait for a better route past its head start", async () => {
    const selected = selectServerRoute(
      ["lan", "tailnet"],
      probeAfter({
        lan: { answer: true, delayMs: 1_500 },
        tailnet: { answer: true, delayMs: 10 },
      }),
    );
    await vi.advanceTimersByTimeAsync(600);
    expect(await selected).toBe("tailnet");
  });

  it("takes a lower-ranked route as soon as every better one has failed", async () => {
    let decided: string | null | undefined;
    void selectServerRoute(
      ["lan", "tailnet", "relay"],
      probeAfter({
        lan: { answer: false, delayMs: 20 },
        tailnet: { answer: false, delayMs: 30 },
        relay: { answer: true, delayMs: 10 },
      }),
    ).then((winner) => {
      decided = winner;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(decided).toBe("relay");
  });

  it("returns null when no route answers", async () => {
    const selected = selectServerRoute(
      ["lan", "relay"],
      probeAfter({
        lan: { answer: false, delayMs: 10 },
        relay: { answer: false, delayMs: 10 },
      }),
    );
    expect(await settle(selected)).toBeNull();
  });
});

describe("orderServerRoutes", () => {
  it("keeps the server's order and appends anchors the server does not advertise", () => {
    const learned = [
      { url: "http://192.168.1.5:38886", source: "learned" },
      { url: "https://owner.getbb.app", source: "learned" },
    ];
    const anchors = [
      { url: "https://owner.getbb.app/", source: "anchor" },
      { url: "http://127.0.0.1:38886", source: "anchor" },
    ];
    expect(orderServerRoutes(learned, anchors)).toEqual([
      { url: "http://192.168.1.5:38886", source: "learned" },
      { url: "https://owner.getbb.app", source: "learned" },
      { url: "http://127.0.0.1:38886", source: "anchor" },
    ]);
  });
});

describe("probeServerRoute", () => {
  function fetchReturning(body: unknown): ServerRouteFetch {
    return async () => Response.json(body);
  }

  it("rejects a route that answers as a different server", async () => {
    await expect(
      probeServerRoute({
        url: "http://192.168.1.5:38886",
        headers: {},
        expectedServerId: "srv_mine",
        fetchFn: fetchReturning({ ok: true, serverId: "srv_other" }),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: "different-server", serverId: "srv_other" });
  });

  it("sends only the headers it is given and refuses redirects", async () => {
    const fetchFn = vi.fn<ServerRouteFetch>(async () =>
      Response.json({ ok: true, serverId: "srv_mine" }),
    );
    await probeServerRoute({
      url: "https://owner.getbb.app",
      headers: { "x-bb-connect-machine": "bbcm" },
      expectedServerId: "srv_mine",
      fetchFn,
      signal: new AbortController().signal,
    });
    const [input, init] = fetchFn.mock.calls[0] ?? [];
    expect(input?.toString()).toBe("https://owner.getbb.app/health");
    expect(init?.headers).toEqual({ "x-bb-connect-machine": "bbcm" });
    expect(init?.redirect).toBe("error");
  });
});
