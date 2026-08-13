import { describe, expect, it } from "vitest";

import type { PlanItem } from "./index.js";
import { orderPlanItems, planItemId } from "./order.js";

function item(label: string, operation: "create" | "delete"): PlanItem {
  return {
    projectId: "project-order",
    projectVersionId: "version-order",
    kind: "component",
    key: label.toLowerCase(),
    label,
    operation,
    expectedBaseContentHash: null,
    fields: [],
    conflicts: [],
    referrers: [],
    error: null,
  };
}

describe("plan ordering", () => {
  it("sorts creates with a parent before its dependent child", () => {
    const parent = item("PARENT", "create");
    const child = item("CHILD", "create");
    const references = new Map<string, readonly string[]>([
      [planItemId(parent), []],
      [planItemId(child), [planItemId(parent)]],
    ]);
    expect(orderPlanItems([child, parent], references).map((entry) => entry.label))
      .toEqual(["PARENT", "CHILD"]);
  });

  it("reverses dependency order for deletes", () => {
    const parent = item("PARENT", "delete");
    const child = item("CHILD", "delete");
    const references = new Map<string, readonly string[]>([
      [planItemId(parent), []],
      [planItemId(child), [planItemId(parent)]],
    ]);
    expect(orderPlanItems([parent, child], references).map((entry) => entry.label))
      .toEqual(["CHILD", "PARENT"]);
  });

  it("turns a reference cycle into named validation errors", () => {
    const first = item("COMPONENT-A", "create");
    const second = item("COMPONENT-B", "create");
    const references = new Map<string, readonly string[]>([
      [planItemId(first), [planItemId(second)]],
      [planItemId(second), [planItemId(first)]],
    ]);
    const ordered = orderPlanItems([first, second], references);
    expect(ordered).toHaveLength(2);
    expect(ordered.every((entry) => entry.error?.code === "REFERENCE_CYCLE")).toBe(true);
    expect(ordered[0]?.error?.message).toContain("COMPONENT-A -> COMPONENT-B -> COMPONENT-A");
  });
});
