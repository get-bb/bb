// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { ThreadSelectionStore } from "./threadSelection.js";

const NONE = { metaKey: false, ctrlKey: false, shiftKey: false };
const META = { ...NONE, metaKey: true };
const SHIFT = { ...NONE, shiftKey: true };
const META_SHIFT = { ...META, shiftKey: true };

function renderSidebar(
  rows: readonly (string | readonly string[])[],
): HTMLDivElement {
  const content = document.createElement("div");
  content.setAttribute("data-sidebar", "content");
  for (const row of rows) {
    if (typeof row === "string") {
      const link = document.createElement("a");
      link.dataset.sidebarThreadId = row;
      link.setAttribute("data-sidebar-thread-shortcut-target", "");
      content.append(link);
    } else {
      const placeholder = document.createElement("div");
      placeholder.setAttribute(
        "data-sidebar-windowed-nav",
        row.map((threadId) => `${threadId}:proj`).join(" "),
      );
      content.append(placeholder);
    }
  }
  document.body.append(content);
  return content;
}

function row(threadId: string): Element {
  const element = document.querySelector(
    `[data-sidebar-thread-id="${threadId}"]`,
  );
  if (element === null) throw new Error(`missing row ${threadId}`);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("ThreadSelectionStore", () => {
  it("seeds a cmd-shift-click selection with the open thread and toggles rows in list order", () => {
    renderSidebar(["a", "b", "c", "d"]);
    const store = new ThreadSelectionStore();
    store.setActiveThreadId("c");

    expect(store.handleClick("a", META_SHIFT, row("a"))).toBe(true);
    expect(store.getSelected()).toEqual(["a", "c"]);
    store.handleClick("d", META_SHIFT, row("d"));
    expect(store.getSelected()).toEqual(["a", "c", "d"]);
    store.handleClick("c", META_SHIFT, row("c"));
    expect(store.getSelected()).toEqual(["a", "d"]);
  });

  it("shift-selects the range from the anchor, including windowed rows that are not mounted", () => {
    renderSidebar(["a", ["b", "c"], "d", "e"]);
    const store = new ThreadSelectionStore();
    store.setActiveThreadId("a");

    expect(store.handleClick("d", SHIFT, row("d"))).toBe(true);
    expect(store.getSelected()).toEqual(["a", "b", "c", "d"]);
    store.handleClick("e", META_SHIFT, row("e"));
    store.handleClick("a", SHIFT, row("a"));
    expect(store.getSelected()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it.each([false, true])(
    "selects a range within an overflow list (portaled: %s)",
    (portaled) => {
      const sidebar = renderSidebar(["main-a", "main-b"]);
      const overflow = renderSidebar(["a", ["b", "c"], "d"]);
      overflow.removeAttribute("data-sidebar");
      overflow.setAttribute("data-sidebar-overflow", "true");
      if (!portaled) sidebar.append(overflow);
      const other = renderSidebar(["other"]);
      other.setAttribute("data-sidebar-overflow", "true");
      const store = new ThreadSelectionStore();
      store.handleClick("a", NONE, row("a"));
      store.handleClick("d", SHIFT, row("d"));
      expect(store.getSelected()).toEqual(["a", "b", "c", "d"]);
      store.handleClick("main-a", NONE, row("main-a"));
      store.handleClick("main-b", SHIFT, row("main-b"));
      expect(store.getSelected()).toEqual(["main-a", "main-b"]);
    },
  );

  it("re-anchors on a plain click, which clears the selection and lets the row open", () => {
    renderSidebar(["a", "b", "c", "d"]);
    const store = new ThreadSelectionStore();
    store.handleClick("a", META_SHIFT, row("a"));
    store.handleClick("b", META_SHIFT, row("b"));

    expect(store.handleClick("c", NONE, row("c"))).toBe(false);
    expect(store.getSelected()).toEqual([]);
    store.handleClick("d", SHIFT, row("d"));
    expect(store.getSelected()).toEqual(["c", "d"]);
  });
});
