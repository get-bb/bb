import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForCloudService } from "../../../scripts/lib/cloud-dev-readiness.mjs";

let server;

afterEach(async () => {
  vi.useRealTimers();
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  server = undefined;
});

describe("local Cloud readiness", () => {
  it("sends the routing Host header through a real Node HTTP request", async () => {
    let receivedHost;
    server = createServer((request, response) => {
      receivedHost = request.headers.host;
      response.writeHead(204).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("test server did not bind a TCP port");
    }

    await waitForCloudService({
      url: `http://127.0.0.1:${address.port}/dashboard`,
      host: "bb.localhost:42745",
      serviceExited: () => false,
    });

    expect(receivedHost).toBe("bb.localhost:42745");
  });

  it("backs off after a 500 response", async () => {
    vi.useFakeTimers();
    const requestImpl = vi
      .fn()
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(204);

    const ready = waitForCloudService({
      url: "http://127.0.0.1:42745/dashboard",
      host: "bb.localhost:42745",
      serviceExited: () => false,
      timeoutMs: 1_000,
      retryDelayMs: 250,
      requestImpl,
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(requestImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await ready;

    expect(requestImpl).toHaveBeenCalledTimes(2);
  });
});
