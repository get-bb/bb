// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  automationRunsInputSchema,
  type AutomationDetailResponse,
  type AutomationRunResponse,
} from "./rpc-types.js";

const app = await loadPluginApp(() => import("../app.js"));
afterEach(cleanup);

const automation: AutomationDetailResponse = {
  id: "auto_1",
  projectId: "proj_personal",
  name: "Query history",
  enabled: true,
  trigger: { triggerType: "schedule", cron: "0 9 * * *", timezone: "UTC" },
  execution: {
    mode: "agent",
    prompt: "Review changes",
    providerId: "claude",
    model: "test-model",
    reasoningLevel: "medium",
    permissionMode: "auto",
    environment: { type: "host", workspace: { type: "personal" } },
  },
  origin: "human",
  createdByThreadId: null,
  nextRunAt: null,
  lastRunAt: null,
  runCount: 2,
  lastRunStatus: null,
  lastRunThreadId: null,
  lastError: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

function run(id: string, revision: number): AutomationRunResponse {
  return {
    id,
    automationId: automation.id,
    runMode: "script",
    threadId: null,
    status: "succeeded",
    trigger: "manual",
    skipReason: null,
    error: null,
    output: `${id} revision ${revision}`,
    exitCode: 0,
    scheduledFor: 1_700_000_000_000,
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_000_100,
  };
}

it("retains loaded run history through pagination errors and refreshes its cursors on relevant signals and reconnect", async () => {
  let revision = 1;
  let failNextPage = true;
  const runs = vi.fn((input: unknown) => {
    const { cursor } = automationRunsInputSchema.parse(input);
    if (cursor !== undefined) {
      if (failNextPage) throw new Error("history temporarily unavailable");
      expect(cursor).toBe(`cursor-${revision}`);
      return { runs: [run("second", revision)], nextCursor: null };
    }
    return { runs: [run("first", revision)], nextCursor: `cursor-${revision}` };
  });
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "proj_personal/auto_1" },
    {
      rpc: {
        automations_get: () => automation,
        automations_overview: () => ({ automations: [] }),
        automations_runs: runs,
      },
    },
  );
  await slot.findByText("first revision 1");
  expect(runs).toHaveBeenCalledTimes(1);
  fireEvent.click(slot.getByRole("button", { name: "Load more" }));
  await slot.findByText("Could not refresh runs.");
  expect(slot.getByText("first revision 1")).toBeTruthy();
  failNextPage = false;
  fireEvent.click(slot.getByRole("button", { name: "Retry" }));
  await slot.findByText("second revision 1");
  expect(slot.queryByRole("button", { name: "Load more" })).toBeNull();
  await slot.emitRealtime("automations", {
    projectId: "other",
    kind: "automation-runs-changed",
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(runs).toHaveBeenCalledTimes(3);
  revision = 2;
  await slot.emitRealtime("automations", {
    projectId: "proj_personal",
    kind: "automation-runs-changed",
  });
  await slot.findByText("second revision 2");
  expect(slot.getByText("first revision 2")).toBeTruthy();
  expect(runs).toHaveBeenCalledTimes(5);
  await slot.setRealtimeConnectionState("reconnecting");
  revision = 3;
  await slot.setRealtimeConnectionState("connected");
  await waitFor(() => expect(slot.getByText("second revision 3")).toBeTruthy());
  expect(slot.getByText("first revision 3")).toBeTruthy();
});
