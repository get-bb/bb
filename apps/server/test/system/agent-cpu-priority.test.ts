import { describe, expect, it } from "vitest";
import { hostDaemonServerWsMessageSchema } from "@bb/host-daemon-contract";
import { readAgentCpuPriority } from "@bb/process-utils";
import { withTestHarness } from "../helpers/test-app.js";
import { seedHostSession } from "../helpers/seed.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

describe("agent CPU priority experiment", () => {
  it("pushes changes to connected daemons and mirrors them for the launcher", async () => {
    await withTestHarness(async (harness) => {
      const { dataDir } = harness.deps.config;
      expect(readAgentCpuPriority(dataDir)).toBe(false);
      const { host, session } = seedHostSession(harness.deps);
      const socket = createMockHubSocket();
      harness.hub.registerDaemon(session.id, host.id, socket);

      for (const agentCpuPriority of [true, false]) {
        const response = await harness.app.request(
          "/api/v1/settings/experiments",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agentCpuPriority }),
          },
        );
        expect(response.status).toBe(200);
        const policies = socket.messages
          .map((message) =>
            hostDaemonServerWsMessageSchema.parse(JSON.parse(message)),
          )
          .filter(
            (message) => message.type === "provider-session-policy.replace",
          );
        expect(policies[policies.length - 1]).toMatchObject({
          agentCpuPriority,
        });
        expect(readAgentCpuPriority(dataDir)).toBe(agentCpuPriority);
      }
    });
  });
});
