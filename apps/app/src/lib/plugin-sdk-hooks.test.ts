import { describe, expect, it, vi } from "vitest";
import { callPluginRpc, fetchPluginSdkSettings } from "./plugin-sdk-hooks";

type FetchLike = Parameters<typeof callPluginRpc>[0];

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

describe("callPluginRpc", () => {
  it("posts JSON to the plugin's rpc route and returns the result", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ ok: true, result: { count: 3 } }),
    );
    const result = await callPluginRpc(fetchImpl, "my plugin", "listIssues", {
      q: "open",
    });
    expect(result).toEqual({ count: 3 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/plugins/my%20plugin/rpc/listIssues",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: "open" }),
      }),
    );
  });

  it("serializes an omitted input as null", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ ok: true, result: null }),
    );
    await callPluginRpc(fetchImpl, "demo", "ping");
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.body).toBe("null");
  });

  it("surfaces { ok: false, error } as a thrown Error", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ ok: false, error: "handler exploded" }, false, 500),
    );
    await expect(callPluginRpc(fetchImpl, "demo", "boom")).rejects.toThrow(
      "handler exploded",
    );
  });

  it("falls back to an HTTP-status message for non-JSON failures", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("not json")),
    }));
    await expect(callPluginRpc(fetchImpl, "demo", "boom")).rejects.toThrow(
      'rpc "boom" failed (HTTP 503)',
    );
  });
});

describe("fetchPluginSdkSettings", () => {
  it("keeps string/boolean values and excludes secret markers by shape", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        ok: true,
        schema: {},
        values: {
          greeting: "hello",
          enabled: true,
          apiKey: { set: true },
          weird: 42,
        },
      }),
    );
    await expect(fetchPluginSdkSettings(fetchImpl, "demo")).resolves.toEqual({
      greeting: "hello",
      enabled: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/plugins/demo/settings");
  });

  it("returns null when settings are unavailable", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ ok: false, error: "not running" }, false, 404),
    );
    await expect(fetchPluginSdkSettings(fetchImpl, "demo")).resolves.toBeNull();
  });
});
