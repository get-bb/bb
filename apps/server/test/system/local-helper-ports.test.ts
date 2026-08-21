import { systemConfigResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("system config local helper ports", () => {
  it("advertises the primary port and distinct ports reported by connected daemons", async () => {
    await withTestHarness(async (harness) => {
      harness.hub.recordDaemonSessionLocalApiPort("session-remote-1", 38_888);
      harness.hub.registerDaemon(
        "session-remote-1",
        "host-remote-1",
        createMockHubSocket(),
      );
      harness.hub.recordDaemonSessionLocalApiPort("session-remote-2", 38_888);
      harness.hub.registerDaemon(
        "session-remote-2",
        "host-remote-2",
        createMockHubSocket(),
      );
      harness.hub.recordDaemonSessionLocalApiPort("session-headless", null);
      harness.hub.registerDaemon(
        "session-headless",
        "host-headless",
        createMockHubSocket(),
      );

      const response = await harness.app.request("/api/v1/system/config");
      const config = systemConfigResponseSchema.parse(await readJson(response));

      expect(config.localHelperPorts).toEqual([
        harness.config.hostDaemonPort,
        38_888,
      ]);
    });
  });
});
