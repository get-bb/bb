import type { ThreadStatus } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBbSdk } from "../src/core.js";
import type { FetchImplementation } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";

const THREAD_PATH = "/api/v1/threads/thr_1";
const STATUS_WAIT_PATH = `${THREAD_PATH}/status/wait`;

function errorResponse(status: number, code: string): Response {
  return Response.json({ code, message: code }, { status });
}

function createFakeServer() {
  let status: ThreadStatus = "active";
  const wakeups = new Set<() => void>();
  const requests: string[] = [];
  const threadResponse = () => Response.json({ id: "thr_1", status });
  const fetch = vi.fn<FetchImplementation>(async (input) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname === THREAD_PATH) return threadResponse();
    if (url.pathname !== STATUS_WAIT_PATH) {
      return errorResponse(404, "not_found");
    }
    if (status !== url.searchParams.get("notStatus")) return threadResponse();
    return new Promise<Response>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        wakeups.delete(wake);
        resolve(threadResponse());
      };
      const timer = setTimeout(
        () => {
          wakeups.delete(wake);
          resolve(new Response(null, { status: 204 }));
        },
        Number(url.searchParams.get("waitMs")),
      );
      wakeups.add(wake);
    });
  });
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      fetch,
      runtime: "node",
    }),
  });
  return {
    requests,
    sdk,
    setStatus(next: ThreadStatus) {
      status = next;
      for (const wake of [...wakeups]) wake();
    },
  };
}

describe("threads.wait for a status", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes two requests for a thread that goes idle after 5 seconds", async () => {
    vi.useFakeTimers();
    const server = createFakeServer();
    setTimeout(() => server.setStatus("idle"), 5_000);

    const wait = server.sdk.threads.wait({ threadId: "thr_1" });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(wait).resolves.toMatchObject({
      matched: true,
      thread: { status: "idle" },
    });
    expect(server.requests).toEqual([THREAD_PATH, STATUS_WAIT_PATH]);
  });

  it("asks again after a long-poll deadline passes with no change", async () => {
    vi.useFakeTimers();
    const server = createFakeServer();
    setTimeout(() => server.setStatus("idle"), 45_000);

    const wait = server.sdk.threads.wait({ threadId: "thr_1" });
    await vi.advanceTimersByTimeAsync(45_000);

    await expect(wait).resolves.toMatchObject({ thread: { status: "idle" } });
    expect(server.requests).toEqual([
      THREAD_PATH,
      STATUS_WAIT_PATH,
      STATUS_WAIT_PATH,
    ]);
  });

  it("reports a deleted thread instead of polling it", async () => {
    let calls = 0;
    const fetch = vi.fn<FetchImplementation>(async (input) => {
      calls += 1;
      return new URL(String(input)).pathname === THREAD_PATH
        ? Response.json({ id: "thr_1", status: "active" })
        : errorResponse(404, "thread_not_found");
    });
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch,
        runtime: "node",
      }),
    });

    await expect(sdk.threads.wait({ threadId: "thr_1" })).rejects.toMatchObject(
      { code: "thread_not_found", status: 404 },
    );
    expect(calls).toBe(2);
  });
});
