import { describe, expect, it } from "vitest";
import {
  cockpitDiscoverySchema,
  cockpitReceiptSchema,
} from "@bb/domain";
import { readJson } from "../helpers/json.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("cockpit-control API", () => {
  it("discovers a running session with supported actions", async () => {
    await withTestHarness(async (harness) => {
      const { host, thread } = seedThreadFixture(harness, {
        thread: { status: "active", title: "Cockpit session" },
      });
      const response = await harness.app.request("/api/v1/cockpit");
      expect(response.status).toBe(200);
      const discovery = cockpitDiscoverySchema.parse(await readJson(response));
      expect(discovery.sessions).toHaveLength(1);
      expect(discovery.agents).toHaveLength(1);
      expect(discovery.sessions[0]?.displayName).toBe("Cockpit session");
      expect(discovery.sessions[0]?.hostId).toBe(host.id);
      expect(discovery.sessions[0]?.supportedActions).toEqual([
        "steer",
        "pause",
        "take_over",
      ]);
      expect(discovery.agents[0]?.ownerRef).toBe(
        discovery.sessions[0]?.ownerRef,
      );
      expect(thread.id).toBeTruthy();
    });
  });

  it("pauses a running session and replays the idempotency key", async () => {
    await withTestHarness(async (harness) => {
      seedThreadFixture(harness, {
        thread: { status: "active", title: "Pause me" },
      });
      const discovery = cockpitDiscoverySchema.parse(
        await readJson(await harness.app.request("/api/v1/cockpit")),
      );
      const ownerRef = discovery.sessions[0]?.ownerRef;
      const hostId = discovery.sessions[0]?.hostId;
      expect(ownerRef).toBeTruthy();
      expect(hostId).toBeTruthy();
      if (ownerRef === undefined || hostId === undefined) {
        throw new Error("expected a discovered session");
      }

      const request = {
        ownerRef,
        action: { kind: "pause" },
        idempotencyKey: "pause-1",
        hostId,
        confirmation: "none",
      };
      const pausePromise = harness.app.request("/api/v1/cockpit/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const stop = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.stop",
      );
      await reportQueuedCommandSuccess(harness, stop, {
        providerCheckpointId: null,
      });
      const first = cockpitReceiptSchema.parse(await readJson(await pausePromise));
      expect(first.outcome).toBe("accepted");
      expect(first.effectClass).toBe("reversible_write");

      const replay = cockpitReceiptSchema.parse(
        await readJson(
          await harness.app.request("/api/v1/cockpit/actions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
          }),
        ),
      );
      expect(replay.outcome).toBe("replayed");
      expect(replay.receiptId).toBe(first.receiptId);
    });
  });

  it("rejects unauthorized, wrong-host, and human-gate actions", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedThreadFixture(harness, {
        thread: { status: "active", title: "Guard me" },
      });
      const discovery = cockpitDiscoverySchema.parse(
        await readJson(await harness.app.request("/api/v1/cockpit")),
      );
      const ownerRef = discovery.sessions[0]?.ownerRef;
      expect(ownerRef).toBeTruthy();
      if (ownerRef === undefined) {
        throw new Error("expected a discovered session");
      }

      const unauthorized = cockpitReceiptSchema.parse(
        await readJson(
          await harness.app.request("/api/v1/cockpit/actions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ownerRef: "not-a-handle",
              action: { kind: "pause" },
              idempotencyKey: "unauthorized",
              hostId: host.id,
              confirmation: "none",
            }),
          }),
        ),
      );
      expect(unauthorized.outcome).toBe("rejected");
      expect(unauthorized.error?.code).toBe("unauthorized");

      const wrongHost = cockpitReceiptSchema.parse(
        await readJson(
          await harness.app.request("/api/v1/cockpit/actions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ownerRef,
              action: { kind: "pause" },
              idempotencyKey: "wrong-host",
              hostId: "host-other",
              confirmation: "none",
            }),
          }),
        ),
      );
      expect(wrongHost.outcome).toBe("rejected");
      expect(wrongHost.error?.code).toBe("wrong_host");

      const humanGate = cockpitReceiptSchema.parse(
        await readJson(
          await harness.app.request("/api/v1/cockpit/actions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ownerRef,
              action: { kind: "mfa" },
              idempotencyKey: "mfa",
              hostId: host.id,
              confirmation: "none",
            }),
          }),
        ),
      );
      expect(humanGate.outcome).toBe("rejected");
      expect(humanGate.error?.code).toBe("human_gate");
    });
  });
});
