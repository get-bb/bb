import { afterEach, describe, expect, it, vi } from "vitest";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

const NativeResponse = globalThis.Response;

class AlternateResponse extends NativeResponse {
  #readText = () => super.text();

  override text(): Promise<string> {
    return this.#readText();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("host installer response readers", () => {
  it("reads native installer events when the global Response is replaced", async () => {
    const events = [
      { type: "started", provider: "test-provider", command: "test-installer" },
      {
        type: "output",
        provider: "test-provider",
        stream: "stdout",
        text: "ready",
      },
      {
        type: "completed",
        provider: "test-provider",
        exitCode: 0,
        signal: null,
        success: true,
      },
    ];
    const response = new NativeResponse(
      events.map((event) => JSON.stringify(event)).join("\r\n\n") + "\n",
    );
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        fetch: async () => response,
      }),
    });
    vi.stubGlobal("Response", AlternateResponse);

    await expect(
      sdk.hosts.installProviderCli({
        hostId: "test-host",
        provider: "test-provider",
        actionKind: "update",
      }),
    ).resolves.toEqual(events);
    expect(response.bodyUsed).toBe(true);
  });
});
