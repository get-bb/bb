import fs from "node:fs/promises";
import path from "node:path";
import { createNodeWebsocketFactory } from "@bb/sdk/node";
import { describe, expect, it } from "vitest";
import { waitForHostConnected } from "../helpers/assertions.js";
import { createIntegrationHarness, withHarness } from "../helpers/harness.js";

describe("integration harness", () => {
  it("closes live WebSockets and cleans up the temp repo", async () => {
    const harness = await createIntegrationHarness();
    const socket = createNodeWebsocketFactory({
      headers: () => ({ authorization: harness.server.localAuthorization }),
    })(`${harness.serverUrl.replace("http:", "ws:")}/ws`);
    let cleanup: Promise<void> | null = null;
    try {
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () =>
          reject(new Error("Harness WebSocket failed to open"));
      });
      const host = await waitForHostConnected(harness.api);
      expect(host.id).toBe(harness.hostId);
      await fs.access(harness.repoDir);

      cleanup = harness.cleanup();
      await expect
        .poll(() => socket.readyState, { timeout: 5_000 })
        .toBe(WebSocket.CLOSED);
      await cleanup;
      await expect(fs.access(harness.repoDir)).rejects.toThrow();
    } finally {
      socket.close();
      await (cleanup ?? harness.cleanup());
    }
  });

  it("keeps the same host identity across daemon restarts", async () => {
    await withHarness(async (harness) => {
      const initialHostId = harness.hostId;

      await harness.restartDaemon();
      const host = await waitForHostConnected(harness.api);

      expect(harness.hostId).toBe(initialHostId);
      expect(host.id).toBe(initialHostId);
    });
  });

  it("reloads bb-app managed config through the integration server", async () => {
    await withHarness(async (harness) => {
      await fs.writeFile(
        path.join(harness.server.config.dataDir, "config.json"),
        `${JSON.stringify({ config: { BB_APP_URL: "https://stored.example.test" } })}\n`,
        "utf8",
      );

      const response = await harness.api.system.config.reload.$post({});

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        progress: "complete",
      });
      expect(harness.server.config.appUrl).toBe("https://stored.example.test");
    });
  });
});
