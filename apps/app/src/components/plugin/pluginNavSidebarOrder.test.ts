import { describe, expect, it } from "vitest";
import {
  arrangePluginNavPanels,
  getPluginNavPanelKey,
  reorderPluginNavPanels,
  seedLeadingNavPanelKeys,
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

  it("renders no row for an unregistered key but keeps its slot in the order", () => {
    const { visible, normalizedOrder } = arrangePluginNavPanels({
      panels: [github, docs],
      storedOrder: ["strudel/repl", "docs/vault", "github/pulls"],
      hiddenKeys: [],
    });

    expect(visible.map(getPluginNavPanelKey)).toEqual([
      "docs/vault",
      "github/pulls",
    ]);
    expect(normalizedOrder).toEqual([
      "strudel/repl",
      "docs/vault",
      "github/pulls",
    ]);
  });

  it("returns a late-registering panel to its stored slot", () => {
    const { visible } = arrangePluginNavPanels({
      panels: [github, docs, tasks],
      storedOrder: ["tasks/board", "docs/vault", "github/pulls"],
      hiddenKeys: [],
    });

    expect(visible.map(getPluginNavPanelKey)).toEqual([
      "tasks/board",
      "docs/vault",
      "github/pulls",
    ]);
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

describe("seedLeadingNavPanelKeys", () => {
  it("leaves an untouched order empty so registry order still wins", () => {
    expect(seedLeadingNavPanelKeys([], ["__builtin__/tools"])).toEqual([]);
  });

  it("prepends a built-in key that a customized order predates", () => {
    expect(
      seedLeadingNavPanelKeys(
        ["github/pulls", "docs/vault"],
        ["__builtin__/tools"],
      ),
    ).toEqual(["__builtin__/tools", "github/pulls", "docs/vault"]);
  });

  it("keeps the user's slot for a built-in key they already moved", () => {
    expect(
      seedLeadingNavPanelKeys(
        ["github/pulls", "__builtin__/tools"],
        ["__builtin__/tools"],
      ),
    ).toEqual(["github/pulls", "__builtin__/tools"]);
  });
});
