import { describe, expect, it } from "vitest";
import {
  TUNNEL_STATUS_HEADER,
  TUNNEL_STATUS_URL,
  isLive,
  presenceWritesOnChange,
  readTunnelConnected,
  tunnelConnectedLookup,
} from "../src/index.js";

function namespaceAnswering(answer: (url: string) => Promise<Response>) {
  const names: string[] = [];
  const urls: string[] = [];
  return {
    names,
    urls,
    namespace: {
      idFromName: (name: string) => {
        names.push(name);
        return name;
      },
      get: () => ({
        fetch: (url: string) => {
          urls.push(url);
          return answer(url);
        },
      }),
    },
  };
}

function statusResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { [TUNNEL_STATUS_HEADER]: "1", ...init.headers },
  });
}

describe("readTunnelConnected", () => {
  it("reads the tunnel object's own answer for the routing key", async () => {
    const online = namespaceAnswering(async () =>
      statusResponse({ connected: true }),
    );
    await expect(readTunnelConnected(online.namespace, "sawyer")).resolves.toBe(
      true,
    );
    expect(online.names).toEqual(["sawyer"]);
    expect(online.urls).toEqual([TUNNEL_STATUS_URL]);

    const offline = namespaceAnswering(async () =>
      statusResponse({ connected: false }),
    );
    await expect(
      readTunnelConnected(offline.namespace, "sawyer"),
    ).resolves.toBe(false);
  });

  it("reports unknown for anything that is not a marked status answer", async () => {
    const unmarked = namespaceAnswering(async () =>
      Response.json({ connected: true }),
    );
    const proxiedPage = namespaceAnswering(
      async () => new Response("<html>", { status: 200 }),
    );
    const malformed = namespaceAnswering(async () =>
      statusResponse({ connected: "yes" }),
    );
    const failed = namespaceAnswering(async () =>
      statusResponse({ connected: true }, { status: 500 }),
    );
    const thrown = namespaceAnswering(async () => {
      throw new Error("Network connection lost.");
    });
    for (const probe of [unmarked, proxiedPage, malformed, failed, thrown]) {
      await expect(
        readTunnelConnected(probe.namespace, "sawyer"),
      ).resolves.toBeNull();
    }
  });
});

describe("presence mode", () => {
  it("is on-change only for that exact value, so a mistyped setting keeps the periodic write", () => {
    expect(presenceWritesOnChange({})).toBe(false);
    expect(presenceWritesOnChange({ PRESENCE_WRITES: "periodic" })).toBe(false);
    expect(presenceWritesOnChange({ PRESENCE_WRITES: "on-change" })).toBe(true);
    expect(presenceWritesOnChange({ PRESENCE_WRITES: "on" })).toBe(false);
    expect(presenceWritesOnChange({ PRESENCE_WRITES: "onchange" })).toBe(false);
  });

  it("only asks tunnel objects in on-change mode", async () => {
    const probe = namespaceAnswering(async () =>
      statusResponse({ connected: true }),
    );
    expect(tunnelConnectedLookup({}, probe.namespace)).toBeNull();
    const lookup = tunnelConnectedLookup(
      { PRESENCE_WRITES: "on-change" },
      probe.namespace,
    );
    await expect(lookup?.("sawyer")).resolves.toBe(true);
  });
});

describe("isLive", () => {
  const base = { now: 1_000_000, offlineAfterMs: 90_000 };

  it("trusts the tunnel object over a stale or fresh timestamp", () => {
    expect(isLive({ ...base, lastSeenMs: null, tunnelConnected: true })).toBe(
      true,
    );
    expect(
      isLive({ ...base, lastSeenMs: base.now - 1_000, tunnelConnected: false }),
    ).toBe(false);
  });

  it("falls back to the timestamp window when the tunnel object is unknown", () => {
    expect(
      isLive({ ...base, lastSeenMs: base.now - 89_000, tunnelConnected: null }),
    ).toBe(true);
    expect(
      isLive({ ...base, lastSeenMs: base.now - 90_000, tunnelConnected: null }),
    ).toBe(false);
    expect(isLive({ ...base, lastSeenMs: null, tunnelConnected: null })).toBe(
      false,
    );
  });
});
