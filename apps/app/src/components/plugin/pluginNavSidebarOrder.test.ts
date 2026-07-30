import { describe, expect, it } from "vitest";
import {
  arrangePluginNavPanels,
  getPluginNavPanelKey,
  reorderPluginNavPanels,
} from "./pluginNavSidebarOrder";

function panel(pluginId: string, id: string) {
  return { pluginId, id };
}

const github = panel("github", "pulls");
const docs = panel("docs", "vault");
const tasks = panel("tasks", "board");

describe("arrangePluginNavPanels", () => {
  it("falls back to registry order before the user has reordered anything", () => {
    const { visible, normalizedOrder } = arrangePluginNavPanels({
      panels: [github, docs, tasks],
      storedOrder: [],
      hiddenKeys: [],
    });

    expect(visible.map(getPluginNavPanelKey)).toEqual([
      "github/pulls",
      "docs/vault",
      "tasks/board",
    ]);
    expect(normalizedOrder).toEqual([
      "github/pulls",
      "docs/vault",
      "tasks/board",
    ]);
  });

  it("appends newly installed panels last instead of at the top of a customized list", () => {
    const { visible } = arrangePluginNavPanels({
      panels: [github, docs, tasks],
      storedOrder: ["tasks/board", "github/pulls"],
      hiddenKeys: [],
    });

    expect(visible.map(getPluginNavPanelKey)).toEqual([
      "tasks/board",
      "github/pulls",
      "docs/vault",
    ]);
  });

  it("drops stored keys for panels that are no longer registered", () => {
    const { normalizedOrder } = arrangePluginNavPanels({
      panels: [github, docs],
      storedOrder: ["strudel/repl", "docs/vault", "github/pulls"],
      hiddenKeys: [],
    });

    expect(normalizedOrder).toEqual(["docs/vault", "github/pulls"]);
  });

  it("splits hidden panels out while both lists keep the user's order", () => {
    const { visible, hidden } = arrangePluginNavPanels({
      panels: [github, docs, tasks],
      storedOrder: ["tasks/board", "docs/vault", "github/pulls"],
      hiddenKeys: ["docs/vault", "tasks/board"],
    });

    expect(visible.map(getPluginNavPanelKey)).toEqual(["github/pulls"]);
    expect(hidden.map(getPluginNavPanelKey)).toEqual([
      "tasks/board",
      "docs/vault",
    ]);
  });

  it("ignores duplicate stored keys so a corrupted list can't render a panel twice", () => {
    const { visible } = arrangePluginNavPanels({
      panels: [github, docs],
      storedOrder: ["github/pulls", "github/pulls", "docs/vault"],
      hiddenKeys: [],
    });

    expect(visible.map(getPluginNavPanelKey)).toEqual([
      "github/pulls",
      "docs/vault",
    ]);
  });
});

describe("reorderPluginNavPanels", () => {
  it("moves a visible row to the target slot", () => {
    expect(
      reorderPluginNavPanels({
        activeKey: "tasks/board",
        overKey: "github/pulls",
        order: ["github/pulls", "docs/vault", "tasks/board"],
        visibleKeys: ["github/pulls", "docs/vault", "tasks/board"],
      }),
    ).toEqual(["tasks/board", "github/pulls", "docs/vault"]);
  });

  it("keeps hidden panels pinned to their index in the stored order", () => {
    // docs is hidden and sits between the two visible rows; swapping those two
    // must not shuffle docs, so unhiding it later restores its old slot.
    expect(
      reorderPluginNavPanels({
        activeKey: "tasks/board",
        overKey: "github/pulls",
        order: ["github/pulls", "docs/vault", "tasks/board"],
        visibleKeys: ["github/pulls", "tasks/board"],
      }),
    ).toEqual(["tasks/board", "docs/vault", "github/pulls"]);
  });

  it("returns null when the drag lands where it started", () => {
    expect(
      reorderPluginNavPanels({
        activeKey: "github/pulls",
        overKey: "github/pulls",
        order: ["github/pulls", "docs/vault"],
        visibleKeys: ["github/pulls", "docs/vault"],
      }),
    ).toBeNull();
  });

  it("returns null when the drop target is not a visible row", () => {
    expect(
      reorderPluginNavPanels({
        activeKey: "github/pulls",
        overKey: "docs/vault",
        order: ["github/pulls", "docs/vault"],
        visibleKeys: ["github/pulls"],
      }),
    ).toBeNull();
  });
});
