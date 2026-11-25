import { describe, expect, it } from "vitest";
import type { JsonValue } from "@bb/domain";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";
import type { FetchImplementation } from "../src/response.js";

const THREAD = {
  id: "thr_1",
  projectId: "proj_1",
  environmentId: null,
  parentThreadId: null,
  parentNotifications: "auto",
  pinnedAt: null,
  status: "idle",
  title: "Status",
};

function routeBody(pathname: string): JsonValue {
  switch (pathname) {
    case "/api/v1/threads/thr_1":
      return THREAD;
    case "/api/v1/threads/thr_1/head-state":
      return { pendingTodos: null };
    case "/api/v1/threads":
      return [];
    default:
      throw new Error(`Unexpected request ${pathname}`);
  }
}

describe("sdk.status.get", () => {
  it("reads the thread's TODOs and child threads at the same time", async () => {
    const inFlight = new Set<string>();
    const overlaps: string[][] = [];
    const fetchMock: FetchImplementation = async (input) => {
      const { pathname } = new URL(String(input));
      inFlight.add(pathname);
      overlaps.push([...inFlight].sort());
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight.delete(pathname);
      return new Response(JSON.stringify(routeBody(pathname)), {
        headers: { "content-type": "application/json" },
      });
    };
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: fetchMock,
        runtime: "node",
      }),
    });

    const result = await sdk.status.get({ threadId: "thr_1" });

    expect(result.childThreads).toEqual([]);
    expect(overlaps).toContainEqual([
      "/api/v1/threads",
      "/api/v1/threads/thr_1/head-state",
    ]);
  });
});
