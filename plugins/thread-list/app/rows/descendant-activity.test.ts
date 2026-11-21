import { describe, expect, it } from "vitest";
import {
  getWorkingDescendants,
  isWorkingThread,
} from "./descendant-activity.js";

function thread(
  id: string,
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
    id,
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
      expect(isWorkingThread(thread("a", { runtimeStatus }))).toBe(true);
    },
  );

  it.each(["error", "idle", "pending", "waiting-for-host"] as const)(
    "does not count a %s runtime as working",
    (runtimeStatus) => {
      expect(isWorkingThread(thread("a", { runtimeStatus }))).toBe(false);
    },
  );

  it.each([
    "workflows",
    "backgroundAgents",
    "backgroundCommands",
    "planMode",
  ] as const)("counts idle %s activity as working", (activity) => {
    expect(isWorkingThread(thread("a", { [activity]: 1 }))).toBe(true);
  });

  it("does not count a failed thread as working", () => {
    expect(isWorkingThread(thread("a", { runtimeStatus: "error" }))).toBe(
      false,
    );
  });

  it("does not count a thread blocked on the user as working", () => {
    expect(
      isWorkingThread(thread("a", { runtimeStatus: "waiting-for-host" })),
    ).toBe(false);
  });
});

describe("getWorkingDescendants", () => {
  it("returns nothing for a leaf", () => {
    expect(getWorkingDescendants([])).toEqual([]);
  });

  it("keeps only the working threads in a subtree", () => {
    const working = thread("b", { runtimeStatus: "active" });
    const alsoWorking = thread("c", { workflows: 2 });
    expect(
      getWorkingDescendants([
        thread("a"),
        working,
        alsoWorking,
        thread("d", { runtimeStatus: "error" }),
      ]),
    ).toEqual([working, alsoWorking]);
  });

  it("preserves the subtree order", () => {
    const first = thread("first", { runtimeStatus: "active" });
    const second = thread("second", { runtimeStatus: "starting" });
    expect(getWorkingDescendants([first, second])).toEqual([first, second]);
  });

  it("returns nothing when a subtree is entirely idle", () => {
    expect(getWorkingDescendants([thread("a"), thread("b")])).toEqual([]);
  });
});
