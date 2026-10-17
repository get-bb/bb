import { describe, expect, it } from "vitest";
import type { Task } from "./contract.js";
import { applyEdit, matchesFilters } from "./task-edit.js";
import { makeTask } from "../test-fixtures.js";
function task(overrides: Partial<Task> & Pick<Task, "id">): Task {
  return makeTask({
    projectId: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  });
}
describe("applyEdit", () => {
  it("overlays only the edited fields, including dueDate:null and position", () => {
    const base = task({ id: "T1", status: "todo", dueDate: "2026-07-20" });
    expect(applyEdit(base, undefined)).toBe(base);
    expect(applyEdit(base, {})).toBe(base);
    expect(applyEdit(base, { status: "done" }).status).toBe("done");
    expect(applyEdit(base, { dueDate: null }).dueDate).toBeNull();
    expect(applyEdit(base, { position: 42 }).position).toBe(42);
    expect(applyEdit(base, { status: "done" }).dueDate).toBe("2026-07-20");
  });
});
describe("matchesFilters", () => {
  const t = task({
    id: "T1",
    status: "in_progress",
    priority: "high",
    labelIds: ["A"],
  });

  it("passes with no filters", () => {
    expect(matchesFilters(t, [], [], [])).toBe(true);
  });

  it("filters by status, priority, and label any-of", () => {
    expect(matchesFilters(t, ["in_progress"], [], [])).toBe(true);
    expect(matchesFilters(t, ["todo"], [], [])).toBe(false);
    expect(matchesFilters(t, [], ["low"], [])).toBe(false);
    expect(matchesFilters(t, [], [], ["A"])).toBe(true);
    expect(matchesFilters(t, [], [], ["B"])).toBe(false);
    expect(matchesFilters(t, [], [], ["B", "A"])).toBe(true);
  });
});
