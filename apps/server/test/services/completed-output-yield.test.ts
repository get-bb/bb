import {
  COMPLETED_EVENT_OUTPUT_RETENTION_MS,
  DEFAULT_COMPLETED_EVENT_OUTPUT_TRUNCATION_BATCH_SIZE,
} from "@bb/db";
import { turnScope } from "@bb/domain";
import { expect, it, vi } from "vitest";
import {
  resetEventLoopWorkForTests,
  takeEventLoopWorkWindowSnapshot,
} from "../../src/services/system/event-loop-work.js";
import { runPeriodicSweeps } from "../../src/services/system/periodic-sweeps.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { testLogger, withTestHarness } from "../helpers/test-app.js";

it("truncates completed event outputs across event-loop turns", async () => {
  await withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, {
      id: "host-output-truncation",
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(harness.deps, {
      environmentId: environment.id,
      projectId: project.id,
      status: "idle",
    });
    const eventCount = DEFAULT_COMPLETED_EVENT_OUTPUT_TRUNCATION_BATCH_SIZE;
    const createdAt = Date.now() - COMPLETED_EVENT_OUTPUT_RETENTION_MS - 60_000;
    const truncationThresholdChars = 32 * 1024;
    const aggregatedOutput = "x".repeat(truncationThresholdChars * 4);
    for (let sequence = 1; sequence <= eventCount; sequence += 1) {
      seedEvent(harness.deps, {
        createdAt,
        data: {
          item: {
            aggregatedOutput,
            approvalStatus: null,
            command: "generate output",
            cwd: "/tmp/test",
            exitCode: 0,
            id: `command-${sequence}`,
            status: "completed",
            type: "commandExecution",
          },
        },
        environmentId: environment.id,
        providerThreadId: "provider-output-truncation",
        scope: turnScope("turn-output-truncation"),
        sequence,
        threadId: thread.id,
        type: "item/completed",
      });
    }

    const countTruncated = () =>
      harness.db.$client
        .prepare<[], { count: number }>(`
          SELECT count(*) AS count
          FROM events
          WHERE json_type(data, '$.item.truncation.aggregatedOutput') = 'object'
        `)
        .get()?.count ?? 0;
    const candidateCount =
      harness.db.$client
        .prepare<[number, number], { count: number }>(`
          SELECT count(*) AS count
          FROM events
          WHERE type = 'item/completed'
            AND item_kind = 'commandExecution'
            AND created_at < ?
            AND json_type(data, '$.item.aggregatedOutput') = 'text'
            AND length(json_extract(data, '$.item.aggregatedOutput')) > ?
        `)
        .get(
          Date.now() - COMPLETED_EVENT_OUTPUT_RETENTION_MS,
          truncationThresholdChars,
        )?.count ?? 0;
    expect(candidateCount).toBeGreaterThan(1);

    const observedCounts: number[] = [];
    let sweepSettled = false;
    const probe = () => {
      if (sweepSettled) {
        return;
      }
      observedCounts.push(countTruncated());
      setImmediate(probe);
    };
    setImmediate(probe);

    const deps = {
      ...harness.deps,
      logger: { ...testLogger, error: vi.fn() },
      pluginSchedules: harness.pluginService,
      plugins: harness.pluginService,
      pluginService: harness.pluginService,
      pluginCatalogService: harness.pluginCatalogService,
    };
    resetEventLoopWorkForTests();
    let slowestWork: string | null = null;
    try {
      await runPeriodicSweeps(deps);
      slowestWork = takeEventLoopWorkWindowSnapshot().slowestWork;
    } finally {
      sweepSettled = true;
      resetEventLoopWorkForTests();
    }

    expect(deps.logger.error).not.toHaveBeenCalled();
    expect(countTruncated()).toBe(candidateCount);
    expect(slowestWork).toBe("sweep:completed-event-output-truncation:advance");
    expect(
      observedCounts.some((count) => count > 0 && count < candidateCount),
    ).toBe(true);
  });
});
