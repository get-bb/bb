import { describe, expect, it } from "vitest";
import { BB_WORKFLOW_TASK_TYPE, type WorkflowProgressSnapshot } from "@bb/domain";
import { turnRow, workflowRow } from "@/test/fixtures/thread-timeline-rows";
import { selectThreadPromptWorkflowsSection } from "./threadPromptWorkflowsSection";

const runningSnapshot: WorkflowProgressSnapshot = {
  phases: [{ index: 1, title: "Scan" }],
  agents: [
    {
      index: 1,
      label: "alpha",
      state: "done",
      model: "haiku",
      attempt: 1,
      cached: false,
      lastProgressAt: 1,
    },
    {
      index: 2,
      label: "bravo",
      state: "running",
      model: "haiku",
      attempt: 1,
      cached: false,
      lastProgressAt: 2,
    },
    {
      index: 3,
      label: "charlie",
      state: "queued",
      model: "haiku",
      attempt: 1,
      cached: false,
      lastProgressAt: 3,
    },
  ],
};

function activeBbWorkflowRow({
  id,
  itemId,
  workflow = null,
}: {
  id: string;
  itemId: string;
  workflow?: WorkflowProgressSnapshot | null;
}) {
  return workflowRow({
    id,
    itemId,
    status: "pending",
    taskStatus: "running",
    taskType: BB_WORKFLOW_TASK_TYPE,
    workflowName: `Workflow ${itemId}`,
    workflow,
  });
}

describe("selectThreadPromptWorkflowsSection", () => {
  it("returns null when no workflow rows are active", () => {
    const rows = [
      // Settled run.
      workflowRow({
        id: "wf-1",
        itemId: "wfr_done",
        status: "completed",
        taskStatus: "completed",
        taskType: BB_WORKFLOW_TASK_TYPE,
      }),
      // Paused run: item status stays "pending" by design but it is
      // resumable, not running — the banner must not surface it.
      workflowRow({
        id: "wf-2",
        itemId: "wfr_paused",
        status: "pending",
        taskStatus: "paused",
        taskType: BB_WORKFLOW_TASK_TYPE,
      }),
    ];

    expect(selectThreadPromptWorkflowsSection(rows)).toBeNull();
  });

  it("excludes active provider-native local_workflow rows (no run page)", () => {
    const rows = [
      workflowRow({
        id: "wf-local",
        itemId: "task-1",
        status: "pending",
        taskStatus: "running",
      }),
    ];

    expect(selectThreadPromptWorkflowsSection(rows)).toBeNull();
  });

  it("surfaces an active bb workflow run with run-page link and agent progress", () => {
    const rows = [
      activeBbWorkflowRow({
        id: "wf-1",
        itemId: "wfr_abc",
        workflow: runningSnapshot,
      }),
    ];

    expect(selectThreadPromptWorkflowsSection(rows)).toEqual({
      items: [
        {
          id: "wfr_abc",
          name: "Workflow wfr_abc",
          agentProgress: "1/3 agents",
          href: "/workflows/runs/wfr_abc",
        },
      ],
    });
  });

  it("omits agent progress when the run reported no agents", () => {
    const rows = [activeBbWorkflowRow({ id: "wf-1", itemId: "wfr_abc" })];

    const section = selectThreadPromptWorkflowsSection(rows);
    expect(section?.items[0]?.agentProgress).toBeNull();
  });

  it("finds active runs nested inside turn children", () => {
    const rows = [
      turnRow({
        children: [
          activeBbWorkflowRow({ id: "wf-nested", itemId: "wfr_nested" }),
        ],
      }),
    ];

    const section = selectThreadPromptWorkflowsSection(rows);
    expect(section?.items.map((item) => item.id)).toEqual(["wfr_nested"]);
  });
});
