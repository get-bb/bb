import { describe, expect, it } from "vitest";
import {
  arrangePluginNavPanels,
  getPluginNavPanelKey,
  movePluginNavPanelToOverflow,
  movePluginNavPanelToTop,
  normalizePluginNavPanelOrder,
  reorderPluginNavPanels,
} from "./pluginNavSidebarOrder";

function panel(pluginId: string, id = "main") {
  return { pluginId, id };
}

const panels = Array.from({ length: 9 }, (_, index) =>
  panel(`plugin-${index + 1}`),
);
const keys = panels.map(getPluginNavPanelKey);

describe("arrangePluginNavPanels", () => {
  it.each([1, 4, 5])("keeps %i pages in one flat list", (count) => {
    const arranged = arrangePluginNavPanels({
      panels: panels.slice(0, count),
      storedOrder: [],
    });
    expect(arranged.visible.map(getPluginNavPanelKey)).toEqual(
      keys.slice(0, count),
    );
    expect(arranged.overflow).toEqual([]);
  });

  it.each([6, 9])("caps %i pages at five", (count) => {
    const arranged = arrangePluginNavPanels({
      panels: panels.slice(0, count),
      storedOrder: [],
    });
    expect(arranged.visible.map(getPluginNavPanelKey)).toEqual(
      keys.slice(0, 5),
    );
    expect(arranged.overflow.map(getPluginNavPanelKey)).toEqual(
      keys.slice(5, count),
    );
  });

  it("appends a newly installed panel after a customized order", () => {
    const arranged = arrangePluginNavPanels({
      panels: panels.slice(0, 3),
      storedOrder: [keys[2], keys[0]],
    });
    expect(arranged.ordered.map(getPluginNavPanelKey)).toEqual([
      keys[2],
      keys[0],
      keys[1],
    ]);
  });

  it("keeps unregistered keys and restores a late registration to its slot", () => {
    const storedOrder = [keys[2], keys[1], keys[0]];
    const before = arrangePluginNavPanels({
      panels: [panels[0], panels[1]],
      storedOrder,
    });
    const after = arrangePluginNavPanels({
      panels: panels.slice(0, 3),
      storedOrder,
    });
    expect(before.normalizedOrder).toEqual(storedOrder);
    expect(before.ordered.map(getPluginNavPanelKey)).toEqual([
      keys[1],
      keys[0],
    ]);
    expect(after.ordered.map(getPluginNavPanelKey)).toEqual(storedOrder);
  });

  it("temporarily promotes the active overflow page into the fifth slot", () => {
    const arranged = arrangePluginNavPanels({
      panels,
      storedOrder: keys,
      activeKey: keys[8],
    });
    expect(arranged.visible.map(getPluginNavPanelKey)).toEqual([
      ...keys.slice(0, 4),
      keys[8],
    ]);
    expect(arranged.overflow.map(getPluginNavPanelKey)).toEqual([
      keys[4],
      ...keys.slice(5, 8),
    ]);
    expect(arranged.normalizedOrder).toEqual(keys);
  });

  it("preserves a migrated fold below five and promotes an active page from zero", () => {
    const folded = arrangePluginNavPanels({
      panels: panels.slice(0, 4),
      storedOrder: keys.slice(0, 4),
      visibleLimit: 2,
    });
    expect(folded.visible.map(getPluginNavPanelKey)).toEqual(keys.slice(0, 2));
    expect(folded.overflow.map(getPluginNavPanelKey)).toEqual(keys.slice(2, 4));

    const allHidden = arrangePluginNavPanels({
      panels: panels.slice(0, 4),
      storedOrder: keys.slice(0, 4),
      visibleLimit: 0,
      activeKey: keys[3],
    });
    expect(allHidden.visible.map(getPluginNavPanelKey)).toEqual([keys[3]]);
    expect(allHidden.overflow.map(getPluginNavPanelKey)).toEqual(
      keys.slice(0, 3),
    );
  });
});

describe("plugin panel order mutations", () => {
  it("drags a row across the cap boundary in the stored order", () => {
    expect(
      reorderPluginNavPanels({
        activeKey: keys[1],
        overKey: keys[7],
        order: keys,
      }),
    ).toEqual([keys[0], ...keys.slice(2, 8), keys[1], keys[8]]);
  });

  it("moves a visible page to the first overflow position", () => {
    expect(movePluginNavPanelToOverflow(keys, keys, keys[1])).toEqual([
      keys[0],
      ...keys.slice(2, 6),
      keys[1],
      ...keys.slice(6),
    ]);
  });

  it("moves an overflow page to the top", () => {
    expect(movePluginNavPanelToTop(keys, keys, keys[7])).toEqual([
      keys[7],
      ...keys.slice(0, 7),
      keys[8],
    ]);
  });

  it("keeps unregistered key slots while moving a registered page", () => {
    const order = ["missing/main", ...keys.slice(0, 6)];
    expect(
      movePluginNavPanelToOverflow(order, keys.slice(0, 6), keys[0]),
    ).toEqual(["missing/main", ...keys.slice(1, 6), keys[0]]);
  });

  it("moves a page below a migrated fold", () => {
    expect(
      movePluginNavPanelToOverflow(
        keys.slice(0, 4),
        keys.slice(0, 4),
        keys[0],
        2,
      ),
    ).toEqual([keys[1], keys[2], keys[0], keys[3]]);
  });
});

describe("normalizePluginNavPanelOrder", () => {
  it("dedupes valid ids and drops malformed values", () => {
    expect(
      normalizePluginNavPanelOrder([keys[0], keys[0], null, "", keys[1]]),
    ).toEqual(keys.slice(0, 2));
    expect(normalizePluginNavPanelOrder({})).toEqual([]);
  });
});
