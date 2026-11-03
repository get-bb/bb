import type {
  ThreadListEntry,
  ThreadQueuedWork,
  ThreadRuntimeDisplayStatus,
  ThreadStatus,
} from "@bb/domain";
import type {
  PluginSidebarThreadIndicator,
  PluginSidebarThreadRowStatus,
  PluginThreadStatusThread,
} from "@get-bb/plugin-sdk";
import { experimental_resolveThreadStatus } from "@get-bb/plugin-sdk/internal/thread-status";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  toPluginSidebarThread,
  toThreadStatusThread,
} from "./plugin-sidebar-threads";

interface ThreadSpec {
  status?: ThreadStatus;
  runtime?: ThreadRuntimeDisplayStatus;
  unread?: boolean;
  parented?: boolean;
  pending?: boolean;
  queued?: ThreadQueuedWork;
  workflows?: number;
  backgroundAgents?: number;
  backgroundCommands?: number;
  planMode?: number;
  goals?: number;
}

interface StatusCase {
  name: string;
  thread: ThreadSpec | null;
  hidden?: ThreadSpec[];
  draft?: boolean;
  rowStatus?: PluginSidebarThreadRowStatus;
  indicator: PluginSidebarThreadIndicator;
  rowStatusShown?: boolean;
  label?: string | null;
  isWorking?: boolean;
}

const ROW_STATUS: PluginSidebarThreadRowStatus = {
  icon: "AiContentGenerator01",
  label: "Plugin improving draft",
};
const RUNNING_ROW_STATUS: PluginSidebarThreadRowStatus = {
  ...ROW_STATUS,
  tone: "running",
};

const RUNNING: ThreadSpec = { status: "active", runtime: "active" };
const UNREAD_SUCCESS: ThreadSpec = { unread: true };
const UNREAD_ERROR: ThreadSpec = { status: "error", unread: true };

const CASES: StatusCase[] = [
  { name: "an idle read thread", thread: {}, indicator: "none" },
  { name: "an idle draft", thread: {}, draft: true, indicator: "draft" },
  ...(["active", "provisioning", "starting", "stopping"] as const).map(
    (runtime): StatusCase => ({
      name: `a ${runtime} runtime`,
      thread: { status: "active", runtime },
      indicator: "runtime",
      isWorking: true,
    }),
  ),
  ...(["error", "idle", "pending", "waiting-for-host"] as const).map(
    (runtime): StatusCase => ({
      name: `a ${runtime} runtime`,
      thread: { runtime },
      indicator: "none",
      isWorking: false,
    }),
  ),
  ...(
    [
      ["workflows", "workflow"],
      ["backgroundAgents", "background-agent"],
      ["backgroundCommands", "background-command"],
      ["planMode", "plan-mode"],
      ["goals", "goal"],
    ] as const
  ).map(([activity, indicator]): StatusCase => ({
    name: `idle ${activity} activity`,
    thread: { [activity]: 1 },
    indicator,
    isWorking: true,
  })),
  {
    name: "an unread idle root",
    thread: UNREAD_SUCCESS,
    indicator: "unread-success",
  },
  {
    name: "an unread error root",
    thread: UNREAD_ERROR,
    indicator: "unread-error",
  },
  {
    name: "an unread parented thread",
    thread: { ...UNREAD_SUCCESS, parented: true },
    indicator: "none",
  },
  {
    name: "an unread pending thread that never ran",
    thread: { status: "pending", unread: true },
    indicator: "none",
  },
  {
    name: "an unread thread still starting",
    thread: { status: "starting", unread: true },
    indicator: "none",
  },
  {
    name: "pending input over runtime",
    thread: { ...RUNNING, pending: true },
    indicator: "waiting-for-input",
    isWorking: true,
  },
  {
    name: "an unread error over runtime",
    thread: { ...UNREAD_ERROR, runtime: "active" },
    indicator: "unread-error",
    isWorking: true,
  },
  {
    name: "a draft over runtime",
    thread: RUNNING,
    draft: true,
    indicator: "working-draft",
  },
  {
    name: "plan mode over runtime",
    thread: { ...RUNNING, planMode: 1 },
    indicator: "plan-mode",
  },
  {
    name: "a goal over runtime",
    thread: { ...RUNNING, goals: 1 },
    indicator: "goal",
  },
  {
    name: "runtime over unread success",
    thread: { ...UNREAD_SUCCESS, runtime: "active" },
    indicator: "runtime",
  },
  ...(["workflows", "backgroundAgents", "backgroundCommands"] as const).map(
    (activity): StatusCase => ({
      name: `runtime over ${activity}`,
      thread: { ...RUNNING, [activity]: 1 },
      indicator: "runtime",
    }),
  ),
  ...(
    [
      "workflows",
      "backgroundAgents",
      "backgroundCommands",
      "planMode",
      "goals",
    ] as const
  ).map((activity): StatusCase => ({
    name: `a working draft with ${activity}`,
    thread: { [activity]: 1 },
    draft: true,
    indicator: "working-draft",
  })),
  {
    name: "a queued send over a draft",
    thread: { queued: "waiting" },
    draft: true,
    indicator: "queued-waiting",
  },
  {
    name: "runtime over a queued send",
    thread: { ...RUNNING, queued: "waiting" },
    indicator: "runtime",
  },
  {
    name: "pending input over a queued send",
    thread: { pending: true, queued: "waiting" },
    indicator: "waiting-for-input",
  },
  {
    name: "a failed queued send",
    thread: { queued: "failed" },
    indicator: "queued-failed",
  },
  {
    name: "a failed send over background work",
    thread: { queued: "failed", backgroundCommands: 1 },
    indicator: "queued-failed",
  },
  {
    name: "runtime over a failed send",
    thread: { ...RUNNING, queued: "failed" },
    indicator: "runtime",
  },
  {
    name: "an unread error over a failed send",
    thread: { ...UNREAD_ERROR, queued: "failed" },
    indicator: "unread-error",
  },
  {
    name: "unread success over a waiting send",
    thread: { ...UNREAD_SUCCESS, queued: "waiting" },
    indicator: "unread-success",
  },
  {
    name: "a failed send over unread success",
    thread: { ...UNREAD_SUCCESS, queued: "failed" },
    indicator: "queued-failed",
  },
  ...(["backgroundAgents", "backgroundCommands"] as const).map(
    (activity): StatusCase => ({
      name: `unread success over ${activity}`,
      thread: { ...UNREAD_SUCCESS, [activity]: 1 },
      indicator: "unread-success",
    }),
  ),
  {
    name: "a workflow over unread success and a failed send",
    thread: { ...UNREAD_SUCCESS, workflows: 1, queued: "failed" },
    indicator: "workflow",
  },
  {
    name: "plan mode over a goal",
    thread: { planMode: 1, goals: 1 },
    indicator: "plan-mode",
  },
  {
    name: "plan mode over a goal and background work",
    thread: {
      planMode: 1,
      goals: 1,
      backgroundAgents: 1,
      backgroundCommands: 1,
    },
    indicator: "plan-mode",
  },
  {
    name: "a goal over background work",
    thread: { goals: 1, backgroundAgents: 1, backgroundCommands: 1 },
    indicator: "goal",
  },
  {
    name: "an unread error over pending input and a workflow",
    thread: { ...UNREAD_ERROR, pending: true, workflows: 1 },
    indicator: "unread-error",
  },
  {
    name: "pending input over a workflow",
    thread: { pending: true, workflows: 1 },
    indicator: "waiting-for-input",
  },
  {
    name: "unread success over an idle draft",
    thread: UNREAD_SUCCESS,
    draft: true,
    indicator: "unread-success",
  },
  {
    name: "attention without work",
    thread: { ...UNREAD_ERROR, pending: true },
    indicator: "unread-error",
    isWorking: false,
  },
  {
    name: "a row status in place of nothing",
    thread: {},
    rowStatus: ROW_STATUS,
    indicator: "none",
    rowStatusShown: true,
    label: "Plugin improving draft",
    isWorking: false,
  },
  {
    name: "a row status in place of a draft",
    thread: {},
    draft: true,
    rowStatus: ROW_STATUS,
    indicator: "draft",
    rowStatusShown: true,
    label: "Plugin improving draft",
  },
  {
    name: "a row status in place of a workflow",
    thread: { workflows: 1 },
    rowStatus: ROW_STATUS,
    indicator: "workflow",
    rowStatusShown: true,
    label: "Plugin improving draft",
  },
  {
    name: "runtime over a row status",
    thread: RUNNING,
    rowStatus: ROW_STATUS,
    indicator: "runtime",
    rowStatusShown: false,
    label: "Thread working",
  },
  {
    name: "an unread error over a row status",
    thread: UNREAD_ERROR,
    rowStatus: ROW_STATUS,
    indicator: "unread-error",
    rowStatusShown: false,
    label: "Unread thread failed",
  },
  {
    name: "pending input over a row status",
    thread: { pending: true },
    rowStatus: ROW_STATUS,
    indicator: "waiting-for-input",
    rowStatusShown: false,
    label: "Thread needs user input",
  },
  {
    name: "a running row status on an idle thread",
    thread: {},
    rowStatus: RUNNING_ROW_STATUS,
    indicator: "none",
    rowStatusShown: true,
    isWorking: true,
  },
  {
    name: "a running row status hidden by pending input",
    thread: { pending: true },
    rowStatus: RUNNING_ROW_STATUS,
    indicator: "waiting-for-input",
    rowStatusShown: false,
    isWorking: true,
  },
  {
    name: "a collapsed parent with a running descendant",
    thread: {},
    hidden: [{ parented: true }, { ...RUNNING, parented: true }],
    indicator: "runtime",
    isWorking: true,
  },
  {
    name: "a collapsed parent with a blocked descendant",
    thread: {},
    hidden: [{ ...RUNNING, parented: true, pending: true }],
    indicator: "waiting-for-input",
    isWorking: true,
  },
  ...(
    [
      ["workflows", "workflow"],
      ["backgroundAgents", "background-agent"],
      ["backgroundCommands", "background-command"],
      ["planMode", "plan-mode"],
      ["goals", "goal"],
    ] as const
  ).map(([activity, indicator]): StatusCase => ({
    name: `a collapsed parent with descendant ${activity}`,
    thread: {},
    hidden: [{ parented: true, [activity]: 1 }],
    indicator,
    isWorking: true,
  })),
  {
    name: "a collapsed parent with unread descendants",
    thread: {},
    hidden: [
      { ...UNREAD_SUCCESS, parented: true },
      { ...UNREAD_ERROR, parented: true },
    ],
    indicator: "none",
  },
  {
    name: "a collapsed parent's own queued send",
    thread: { queued: "waiting" },
    hidden: [{ parented: true }],
    indicator: "queued-waiting",
  },
  {
    name: "a collapsed parent ignores a descendant's failed send",
    thread: {},
    hidden: [{ parented: true, queued: "failed" }],
    indicator: "none",
  },
  {
    name: "a collapsed parent with a draft and descendant work",
    thread: {},
    hidden: [{ parented: true, planMode: 1, goals: 1 }],
    draft: true,
    indicator: "working-draft",
  },
  {
    name: "an empty collapsed group",
    thread: null,
    hidden: [],
    indicator: "none",
    isWorking: false,
  },
  {
    name: "a collapsed group of idle threads",
    thread: null,
    hidden: [{}, {}],
    indicator: "none",
  },
  {
    name: "a collapsed group with unread roots",
    thread: null,
    hidden: [UNREAD_SUCCESS, {}],
    indicator: "unread-success",
  },
  {
    name: "a collapsed group with an unread error, unread success, work, and input",
    thread: null,
    hidden: [UNREAD_ERROR, UNREAD_SUCCESS, RUNNING, { pending: true }],
    indicator: "unread-error",
    isWorking: true,
  },
  {
    name: "a collapsed group keeps a busy unread error visible",
    thread: null,
    hidden: [
      {
        ...UNREAD_ERROR,
        runtime: "active",
        workflows: 1,
        backgroundAgents: 1,
        backgroundCommands: 1,
      },
    ],
    indicator: "unread-error",
    isWorking: true,
  },
  {
    name: "a collapsed group ignores queued sends",
    thread: null,
    hidden: [{ queued: "waiting" }, { queued: "failed" }],
    indicator: "none",
  },
  {
    name: "a collapsed group with a row status",
    thread: null,
    hidden: [{}],
    rowStatus: RUNNING_ROW_STATUS,
    indicator: "none",
    rowStatusShown: true,
    isWorking: true,
  },
];

let nextId = 0;

function toEntry(spec: ThreadSpec): ThreadListEntry {
  nextId += 1;
  return makeThreadListEntry({
    id: `thr_${nextId}`,
    projectId: "proj_1",
    status: spec.status ?? "idle",
    runtime: { displayStatus: spec.runtime ?? "idle" },
    lastReadAt: spec.unread ? 1 : 2,
    latestAttentionAt: 2,
    parentThreadId: spec.parented ? "thr_parent" : null,
    hasPendingInteraction: spec.pending ?? false,
    queuedWork: spec.queued ?? "none",
    activity: {
      activeWorkflowCount: spec.workflows ?? 0,
      activeBackgroundAgentCount: spec.backgroundAgents ?? 0,
      activeBackgroundCommandCount: spec.backgroundCommands ?? 0,
      activePlanModeCount: spec.planMode ?? 0,
      activeGoalCount: spec.goals ?? 0,
    },
  });
}

const CALLERS: {
  name: string;
  toThread: (entry: ThreadListEntry) => PluginThreadStatusThread;
}[] = [
  { name: "core lists", toThread: toThreadStatusThread },
  {
    name: "the thread-list plugin",
    toThread: (entry) => toPluginSidebarThread(entry),
  },
];

describe("experimental_resolveThreadStatus", () => {
  describe.each(CALLERS)("through $name", ({ toThread }) => {
    it.each(CASES)("resolves $name", (testCase) => {
      const status = experimental_resolveThreadStatus({
        thread:
          testCase.thread === null ? null : toThread(toEntry(testCase.thread)),
        hiddenThreads: (testCase.hidden ?? []).map((spec) =>
          toThread(toEntry(spec)),
        ),
        hasUnsubmittedDraft: testCase.draft ?? false,
        rowStatus: testCase.rowStatus ?? null,
      });

      expect(status.indicator).toBe(testCase.indicator);
      if (testCase.rowStatusShown !== undefined) {
        expect(status.rowStatus).toBe(
          testCase.rowStatusShown ? testCase.rowStatus : null,
        );
      }
      if (testCase.label !== undefined) {
        expect(status.label).toBe(testCase.label);
      }
      if (testCase.isWorking !== undefined) {
        expect(status.isWorking).toBe(testCase.isWorking);
      }
    });
  });
});
