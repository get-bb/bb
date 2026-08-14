// @vitest-environment jsdom

import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  getSidebarThreadNavigationTargets,
  getSidebarThreadShortcutTargets,
  observeSidebarThreadShortcutTargets,
} from "./sidebarThreadShortcuts";

function appendShortcutTarget(root: HTMLElement, threadId?: string) {
  const target = document.createElement("a");
  target.dataset.sidebarThreadShortcutTarget = "";
  if (threadId) {
    target.dataset.sidebarThreadId = threadId;
  }
  root.append(target);
  return target;
}

describe("sidebar thread shortcuts", () => {
  it("assigns 1 through 9 in rendered row order", () => {
    const root = document.createElement("aside");
    appendShortcutTarget(root);
    const elements = Array.from({ length: 10 }, (_, index) =>
      appendShortcutTarget(root, `thr_${index + 1}`),
    );

    const targets = getSidebarThreadShortcutTargets(root);

    expect(targets).toHaveLength(9);
    expect(
      targets.map(({ element, key, threadId }) => ({ element, key, threadId })),
    ).toEqual(
      elements.slice(0, 9).map((element, index) => ({
        element,
        key: String(index + 1),
        threadId: `thr_${index + 1}`,
      })),
    );
    expect(getSidebarThreadNavigationTargets(root)).toHaveLength(10);
  });

  it("includes windowed-out placeholder threads in navigation order", () => {
    const root = document.createElement("aside");
    appendShortcutTarget(root, "thr_a");
    const placeholder = document.createElement("div");
    placeholder.setAttribute(
      "data-sidebar-windowed-nav",
      "thr_b:proj_1 thr_c:proj_2",
    );
    root.append(placeholder);
    appendShortcutTarget(root, "thr_d");

    const navigation = getSidebarThreadNavigationTargets(root);
    expect(
      navigation.map(({ threadId, projectId, element }) => ({
        threadId,
        projectId,
        mounted: element !== null,
      })),
    ).toEqual([
      { threadId: "thr_a", projectId: null, mounted: true },
      { threadId: "thr_b", projectId: "proj_1", mounted: false },
      { threadId: "thr_c", projectId: "proj_2", mounted: false },
      { threadId: "thr_d", projectId: null, mounted: true },
    ]);

    // The numbered jump shortcuts render badges on rows, so they must skip
    // placeholder threads and use mounted anchors only.
    expect(
      getSidebarThreadShortcutTargets(root).map((target) => target.threadId),
    ).toEqual(["thr_a", "thr_d"]);
  });

  it("reports rendered rows when they mount, reorder, and unmount", async () => {
    const root = document.createElement("aside");
    const reports: string[][] = [];
    const stopObserving = observeSidebarThreadShortcutTargets(
      root,
      true,
      (targets) => reports.push(targets.map((target) => target.threadId)),
    );

    const first = appendShortcutTarget(root, "thr_1");
    const second = appendShortcutTarget(root, "thr_2");
    await waitFor(() => expect(reports.at(-1)).toEqual(["thr_1", "thr_2"]));

    root.prepend(second);
    await waitFor(() => expect(reports.at(-1)).toEqual(["thr_2", "thr_1"]));

    second.remove();
    await waitFor(() => expect(reports.at(-1)).toEqual(["thr_1"]));

    first.remove();
    await waitFor(() => expect(reports.at(-1)).toEqual([]));

    stopObserving();
    appendShortcutTarget(root, "thr_3");
    await Promise.resolve();
    expect(reports.at(-1)).toEqual([]);
  });

  it("does not observe rows when shortcut assignments are hidden", async () => {
    const root = document.createElement("aside");
    const reports: string[][] = [];
    const stopObserving = observeSidebarThreadShortcutTargets(
      root,
      false,
      (targets) => reports.push(targets.map((target) => target.threadId)),
    );

    appendShortcutTarget(root, "thr_1");
    await Promise.resolve();

    expect(reports).toEqual([]);
    stopObserving();
  });
});
