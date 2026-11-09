import { describe, expect, it } from "vitest";
import {
  countWorkingDescendants,
  isWorkingThread,
} from "./descendant-activity.js";

function thread(
  overrides: Partial<{
    runtimeStatus:
      | "active"
      | "provisioning"
      | "starting"
      | "stopping"
      | "error"
      | "idle"
      | "pending"
      | "waiting-for-host";
    workflows: number;
    backgroundAgents: number;
    backgroundCommands: number;
    planMode: number;
  }> = {},
) {
  return {
    runtimeStatus: overrides.runtimeStatus ?? "idle",
    activity: {
      workflows: overrides.workflows ?? 0,
      backgroundAgents: overrides.backgroundAgents ?? 0,
      backgroundCommands: overrides.backgroundCommands ?? 0,
      planMode: overrides.planMode ?? 0,
    },
  } as Parameters<typeof isWorkingThread>[0];
}

describe("isWorkingThread", () => {
  it.each(["active", "provisioning", "starting", "stopping"] as const)(
    "counts a %s runtime as working",
    (runtimeStatus) => {
      expect(isWorkingThread(thread({ runtimeStatus }))).toBe(true);
    },
  );

  it.each(["error", "idle", "pending", "waiting-for-host"] as const)(
    "does not count a %s runtime as working",
    (runtimeStatus) => {
      expect(isWorkingThread(thread({ runtimeStatus }))).toBe(false);
    },
  );

  it.each([
    "workflows",
    "backgroundAgents",
    "backgroundCommands",
    "planMode",
  ] as const)("counts idle %s activity as working", (activity) => {
    expect(isWorkingThread(thread({ [activity]: 1 }))).toBe(true);
  });

  it("does not count a failed thread as working", () => {
    expect(isWorkingThread(thread({ runtimeStatus: "error" }))).toBe(false);
  });
});

describe("countWorkingDescendants", () => {
  it("returns zero for a leaf", () => {
    expect(countWorkingDescendants([])).toBe(0);
  });

  it("counts only the working threads in a subtree", () => {
    expect(
      countWorkingDescendants([
        thread(),
        thread({ runtimeStatus: "active" }),
        thread({ workflows: 2 }),
        thread({ runtimeStatus: "error" }),
      ]),
    ).toBe(2);
  });

  it("counts every working thread when they all are", () => {
    expect(
      countWorkingDescendants([
        thread({ runtimeStatus: "active" }),
        thread({ runtimeStatus: "starting" }),
      ]),
    ).toBe(2);
  });

  it("counts nothing when a subtree is entirely idle", () => {
    expect(countWorkingDescendants([thread(), thread()])).toBe(0);
  });
});
