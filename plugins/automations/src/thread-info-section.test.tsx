// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import type { AutomationResponse } from "./rpc-types.js";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

function automation(
  overrides: Partial<AutomationResponse> = {},
): AutomationResponse {
  return {
    id: "auto_1",
    projectId: "proj_1",
    name: "Check CI",
    enabled: true,
    trigger: { triggerType: "schedule", cron: "0 9 * * *", timezone: "UTC" },
    execution: {
      mode: "agent",
      prompt: "Check CI.",
      providerId: "claude",
      model: "claude-opus-5",
      reasoningLevel: "medium",
      permissionMode: "auto",
      environment: { type: "project-default" },
      targetThreadId: "thr_1",
    },
    origin: "agent",
    createdByThreadId: null,
    nextRunAt: null,
    lastRunAt: null,
    runCount: 0,
    lastRunStatus: null,
    lastRunThreadId: null,
    lastError: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("automations thread Info section", () => {
  it("lists the thread's automations, refreshes on any project's automation change but not run-only signals, and opens one", async () => {
    const section = app.threadInfoSections[0];
    if (section === undefined) throw new Error("missing Info section");
    let listed: AutomationResponse[] = [];
    const slot = renderSlot(
      section,
      { threadId: "thr_1", projectId: "proj_1", environment: null },
      { rpc: { automations_list: () => listed } },
    );

    await waitFor(() => {
      expect(slot.inspection.rpcCalls).toEqual([
        { method: "automations_list", input: { targetThreadId: "thr_1" } },
      ]);
    });
    expect(screen.queryByRole("region", { name: "Automations" })).toBeNull();

    await slot.behavior.emitRealtime("automations", {
      projectId: "proj_1",
      kind: "automation-runs-changed",
    });
    expect(slot.inspection.rpcCalls).toHaveLength(1);

    listed = [
      automation({
        trigger: { triggerType: "once", runAt: 1_700_000_000_000 },
        enabled: false,
        runCount: 1,
        lastRunStatus: "succeeded",
      }),
      automation({
        id: "auto_2",
        projectId: "proj_other",
        name: "Paused check",
        enabled: false,
      }),
    ];
    await slot.behavior.emitRealtime("automations", {
      projectId: "proj_other",
      kind: "automations-changed",
    });

    expect(
      await screen.findByRole("region", { name: "Automations" }),
    ).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Paused check" }));
    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "automations",
        options: { subPath: "proj_other/auto_2" },
      },
    ]);
  });
});
