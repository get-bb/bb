import { describe, expect, it } from "vitest";
import {
  arrangePluginNavPanels,
  getPluginNavPanelKey,
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
