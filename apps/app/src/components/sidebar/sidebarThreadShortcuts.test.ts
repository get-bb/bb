// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  getSidebarThreadNavigationTargets,
  getSidebarThreadShortcutTargets,
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

});
