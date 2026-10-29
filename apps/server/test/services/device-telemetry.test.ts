import { describe, expect, it, vi } from "vitest";
import { updateThread, events, environments } from "@bb/db";
import { eq } from "drizzle-orm";
import { createTestAppHarness } from "../helpers/test-app.js";
import {
  seedHost,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedEnvironment,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  beginMachineEnrollment,
  recordMachineCredentials,
  recordMachineReady,
  recordMachineSetupResult,
  withDeviceSetupSource,
} from "../../src/services/system/device-telemetry.js";
import {
  executionLocation,
  recordExecutionTarget,
} from "../../src/services/system/turn-telemetry.js";
import type { TelemetryService } from "../../src/services/system/telemetry.js";

describe("device lifecycle measurement", () => {
  it("records source-associated stages once and excludes reconnects and opted-out events", async () => {
    const harness = await createTestAppHarness();
    try {
      const { deps } = harness;
      const capture = vi.fn<TelemetryService["capture"]>();
      let enabled = true;
      deps.telemetry = {
        capture,
        isEnabled: () => enabled,
        setEnabled: (value) => {
          enabled = value;
        },
      };
      const { host: primary } = seedHostSession(deps);
      seedPrimaryHost(deps, primary.id);
      const host = seedHost(deps);
      withDeviceSetupSource("first_run", () =>
        beginMachineEnrollment(deps, host.id),
      );
      beginMachineEnrollment(deps, host.id);
      recordMachineCredentials(deps, host.id);
      recordMachineCredentials(deps, host.id);
      expect(capture).toHaveBeenCalledTimes(2);
      recordMachineReady(deps, host.id);
      recordMachineReady(deps, host.id);
      beginMachineEnrollment(deps, primary.id);
      recordMachineCredentials(deps, primary.id);
      expect(capture).toHaveBeenCalledTimes(3);
      expect(
        capture.mock.calls.map(([event]) =>
          event.name === "device_setup" ? event.properties.source : null,
        ),
      ).toEqual(["first_run", "first_run", "first_run"]);
      expect(JSON.stringify(capture.mock.calls)).not.toContain(host.id);
      enabled = false;
      const silent = seedHost(deps);
      beginMachineEnrollment(deps, silent.id);
      recordMachineCredentials(deps, silent.id);
      recordMachineReady(deps, silent.id);
      expect(capture).toHaveBeenCalledTimes(3);
      enabled = true;
      const failed = seedHost(deps);
      beginMachineEnrollment(deps, failed.id);
      recordMachineSetupResult(deps, failed.id, "unknown");
      recordMachineSetupResult(deps, failed.id, "unknown");
      expect(capture).toHaveBeenCalledTimes(5);
    } finally {
      await harness.cleanup();
    }
  });

  it("uses the authenticated execution snapshot even after thread and environment targets change", async () => {
    const harness = await createTestAppHarness();
    try {
      const { deps } = harness;
      const primary = seedHost(deps);
      seedPrimaryHost(deps, primary.id);
      const other = seedHost(deps);
      const { project } = seedProjectWithSource(deps, { hostId: primary.id });
      const first = seedEnvironment(deps, {
        projectId: project.id,
        hostId: other.id,
      });
      const next = seedEnvironment(deps, {
        projectId: project.id,
        hostId: primary.id,
      });
      const thread = seedThread(deps, {
        projectId: project.id,
        environmentId: first.id,
        status: "active",
      });
      expect(executionLocation(deps, deps.db, thread.id, "active")).toBe(
        "unknown",
      );
      seedTurnStarted(deps, {
        threadId: thread.id,
        environmentId: first.id,
        turnId: "executed-turn",
      });
      recordExecutionTarget(deps, thread.id, "executed-turn", other.id);
      updateThread(deps.db, deps.hub, thread.id, { environmentId: next.id });
      deps.db
        .update(environments)
        .set({ hostId: primary.id, path: "/fixture/moved-execution-target" })
        .where(eq(environments.id, first.id))
        .run();
      expect(executionLocation(deps, deps.db, thread.id, "active")).toBe(
        "additional_machine",
      );
      expect(executionLocation(deps, deps.db, thread.id, "starting")).toBe(
        "unknown",
      );
      deps.db
        .update(events)
        .set({ turnId: "different-turn" })
        .where(eq(events.threadId, thread.id))
        .run();
      expect(executionLocation(deps, deps.db, thread.id, "active")).toBe(
        "unknown",
      );
    } finally {
      await harness.cleanup();
    }
  });
});
