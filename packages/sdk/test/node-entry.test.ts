import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("@bb/sdk/node entry", () => {
  it("imports and builds explicit SDKs without BB server configuration", async () => {
    // `bb --help` and other config-free CLI paths import this module before
    // any server URL exists, so the import itself must not load CLI config.
    vi.stubEnv("BB_SERVER_URL", undefined);
    vi.stubEnv("BB_HOST_DAEMON_PORT", undefined);

    const nodeEntry = await import("../src/node.js");
    const sdk = nodeEntry.createNodeBbSdk({ baseUrl: "http://server" });

    expect(typeof sdk.threads.list).toBe("function");
  });
});
