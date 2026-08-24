import type { Host, ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildMachineThreadGroups,
  NO_MACHINE_GROUP_KEY,
} from "../src/sidebar/machineThreadGroups.js";

function createThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return {
    id: "thr_1",
    projectId: "proj_1",
    environmentId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

function createHost(
  overrides: Partial<Host> & Pick<Host, "id" | "name">,
): Host {
  return {
    type: "persistent",
    status: "connected",
    lastSeenAt: null,
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("buildMachineThreadGroups", () => {
  it("orders known hosts by server order, then unknown hosts, then no-machine", () => {
    const hosts = [
      createHost({ id: "host_a", name: "Laptop" }),
      createHost({ id: "host_b", name: "Desktop" }),
    ];
    const threads = [
      createThread({ id: "thr_1", environmentHostId: "host_b" }),
      createThread({ id: "thr_2", environmentHostId: null }),
      createThread({ id: "thr_3", environmentHostId: "host_gone" }),
      createThread({ id: "thr_4", environmentHostId: "host_a" }),
      createThread({ id: "thr_5", environmentHostId: "host_b" }),
    ];

    const groups = buildMachineThreadGroups(threads, hosts);

    expect(
      groups.map((group) => ({
        key: group.key,
        label: group.label,
        threadIds: group.threads.map((thread) => thread.id),
      })),
    ).toEqual([
      { key: "host_a", label: "Laptop", threadIds: ["thr_4"] },
      { key: "host_b", label: "Desktop", threadIds: ["thr_1", "thr_5"] },
      { key: "host_gone", label: "Unknown machine", threadIds: ["thr_3"] },
      { key: NO_MACHINE_GROUP_KEY, label: "No machine", threadIds: ["thr_2"] },
    ]);
  });

  it("skips machines that have no threads and omits the no-machine group when empty", () => {
    const hosts = [
      createHost({ id: "host_a", name: "Laptop" }),
      createHost({ id: "host_b", name: "Desktop" }),
    ];
    const threads = [
      createThread({ id: "thr_1", environmentHostId: "host_b" }),
    ];

    const groups = buildMachineThreadGroups(threads, hosts);

    expect(groups.map((group) => group.key)).toEqual(["host_b"]);
  });

  it("falls back to id-ordered unknown groups when the host list is empty", () => {
    const threads = [
      createThread({ id: "thr_1", environmentHostId: "host_b" }),
      createThread({ id: "thr_2", environmentHostId: "host_a" }),
    ];

    const groups = buildMachineThreadGroups(threads, []);

    expect(groups.map((group) => group.key)).toEqual(["host_a", "host_b"]);
  });
});
