import { afterEach, expect, it, vi } from "vitest";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

afterEach(() => vi.unstubAllGlobals());

it("reads installer events using the transport response implementation", async () => {
  const events = [
    { type: "started", provider: "test-provider", command: "installer" },
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
  const response = new Response(
    events.map((event) => JSON.stringify(event)).join("\r\n") + "\r\n\n",
  );
  class ServerResponse extends Response {
    #bodyText = "server-owned body";
    override async text() {
      return this.#bodyText;
    }
  }
  vi.stubGlobal("Response", ServerResponse);
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      runtime: "node",
      fetch: async () => response,
    }),
  });
  await expect(
    sdk.hosts.installProviderCli({
      hostId: "test-host",
      provider: "test-provider",
      actionKind: "update",
    }),
  ).resolves.toEqual(events);
});
