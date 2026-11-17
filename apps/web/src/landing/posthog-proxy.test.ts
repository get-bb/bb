import { describe, expect, it, vi } from "vitest";
import {
  postHogProxyPath,
  proxyPostHogRequest,
  type PostHogProxyDeps,
} from "./posthog-proxy";

function harness(cached?: Response) {
  const upstream: Request[] = [];
  const stored: [Request, Response][] = [];
  const pending: Promise<unknown>[] = [];
  const deps: PostHogProxyDeps = {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      upstream.push(new Request(input, init));
      return new Response("upstream", { status: 200 });
    }),
    cache: {
      match: async () => cached,
      put: async (request, response) => {
        stored.push([request, response]);
      },
    },
    waitUntil: (promise) => {
      pending.push(promise);
    },
  };
  return { deps, upstream, stored, pending };
}

describe("postHogProxyPath", () => {
  it.each([
    ["/relay", "/"],
    ["/relay/e/", "/e/"],
    ["/relay/static/array.js", "/static/array.js"],
    ["/relayed", null],
    ["/", null],
    ["/download", null],
  ])("maps %s to %s", (pathname, expected) => {
    expect(postHogProxyPath(pathname)).toBe(expected);
  });
});

describe("proxyPostHogRequest", () => {
  it("leaves site requests to the app", async () => {
    const { deps } = harness();
    const response = await proxyPostHogRequest(
      new Request("https://getbb.app/download?utm_source=qa"),
      deps,
    );
    expect(response).toBeNull();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("forwards events with the visitor IP and without site credentials", async () => {
    const { deps, upstream } = harness();
    const body = new Uint8Array([31, 139, 8, 0, 1, 2, 3]);
    await proxyPostHogRequest(
      new Request("https://getbb.app/relay/e/?compression=gzip-js&_=1", {
        method: "POST",
        headers: {
          cookie: "better-auth.session_token=secret; ph_phc_x_posthog=1",
          authorization: "Bearer session-secret",
          "cf-connecting-ip": "203.0.113.7",
          "x-forwarded-for": "198.51.100.1, 203.0.113.7",
          "content-type": "text/plain",
        },
        body,
      }),
      deps,
    );
    const sent = upstream[0];
    expect(sent?.url).toBe(
      "https://us.i.posthog.com/e/?compression=gzip-js&_=1",
    );
    expect(sent?.method).toBe("POST");
    expect(sent?.headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(sent?.headers.get("cookie")).toBeNull();
    expect(sent?.headers.get("authorization")).toBeNull();
    expect(sent?.headers.get("content-type")).toBe("text/plain");
    expect(new Uint8Array(await sent!.arrayBuffer())).toEqual(body);
  });

  it("keeps PostHog project key authorization", async () => {
    const { deps, upstream } = harness();
    await proxyPostHogRequest(
      new Request("https://getbb.app/relay/i/v0/e/", {
        method: "POST",
        headers: { authorization: "Bearer phc_project" },
        body: "{}",
      }),
      deps,
    );
    expect(upstream[0]?.headers.get("authorization")).toBe(
      "Bearer phc_project",
    );
  });

  it("serves SDK assets from the asset host and caches successful responses", async () => {
    const { deps, upstream, stored, pending } = harness();
    const request = new Request(
      "https://getbb.app/relay/array/phc_project/config.js",
    );
    const response = await proxyPostHogRequest(request, deps);
    await Promise.all(pending);
    expect(await response?.text()).toBe("upstream");
    expect(upstream[0]?.url).toBe(
      "https://us-assets.i.posthog.com/array/phc_project/config.js",
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.[0]).toBe(request);
  });

  it("answers cached assets without calling PostHog", async () => {
    const { deps } = harness(new Response("cached"));
    const response = await proxyPostHogRequest(
      new Request("https://getbb.app/relay/static/surveys.js?v=1"),
      deps,
    );
    expect(await response?.text()).toBe("cached");
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("does not cache failed asset responses", async () => {
    const { deps, stored, pending } = harness();
    deps.fetch = vi.fn(async () => new Response("missing", { status: 404 }));
    const response = await proxyPostHogRequest(
      new Request("https://getbb.app/relay/static/missing.js"),
      deps,
    );
    await Promise.all(pending);
    expect(response?.status).toBe(404);
    expect(stored).toHaveLength(0);
  });
});
