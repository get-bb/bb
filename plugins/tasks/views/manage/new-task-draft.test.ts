// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  NEW_TASK_DRAFT_STORAGE_KEY,
  clearNewTaskDraft,
  loadNewTaskDraft,
  storeNewTaskDraft,
} from "./new-task-draft.js";

beforeEach(() => window.localStorage.clear());

describe("new task draft storage", () => {
  it("reads as unset before anything is stored", () => {
    expect(loadNewTaskDraft()).toBeNull();
  });

  it("round-trips a typed title and description", () => {
    storeNewTaskDraft({ title: "Fix flaky test", description: "See CI run 42" });
    expect(loadNewTaskDraft()).toEqual({
      title: "Fix flaky test",
      description: "See CI run 42",
    });
  });

  it("clears storage once both fields are blank again", () => {
    storeNewTaskDraft({ title: "Something", description: "" });
    storeNewTaskDraft({ title: "   ", description: "" });
    expect(loadNewTaskDraft()).toBeNull();
    expect(window.localStorage.getItem(NEW_TASK_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("treats a blank draft as nothing to restore", () => {
    storeNewTaskDraft({ title: "", description: "" });
    expect(loadNewTaskDraft()).toBeNull();
  });

  it("clearNewTaskDraft removes a stored draft", () => {
    storeNewTaskDraft({ title: "Keep me", description: "" });
    clearNewTaskDraft();
    expect(loadNewTaskDraft()).toBeNull();
  });

  it("treats corrupt or future-version documents as unset rather than throwing", () => {
    window.localStorage.setItem(NEW_TASK_DRAFT_STORAGE_KEY, "{not json");
    expect(loadNewTaskDraft()).toBeNull();

    window.localStorage.setItem(
      NEW_TASK_DRAFT_STORAGE_KEY,
      JSON.stringify({ version: 999, title: "future", description: "" }),
    );
    expect(loadNewTaskDraft()).toBeNull();
  });
});
