import { describe, expect, it } from "vitest";
import { arrangeRightPanelFixedTabs } from "./rightPanelFixedTabPreferences";

const items = ["info", "diff", "files", "usage"];
const getId = (id: string) => id;

describe("arrangeRightPanelFixedTabs", () => {
  it("applies the stored order and appends tabs it has not seen", () => {
    const { shown } = arrangeRightPanelFixedTabs({
      items,
      getId,
      order: ["usage", "removed-plugin-tab", "diff"],
      hidden: [],
      activeId: null,
    });
    expect(shown).toEqual(["usage", "diff", "info", "files"]);
  });

  it("drops hidden tabs from the strip but keeps the selected one", () => {
    const arranged = arrangeRightPanelFixedTabs({
      items,
      getId,
      order: [],
      hidden: ["diff", "files"],
      activeId: "files",
    });
    expect(arranged.shown).toEqual(["info", "files", "usage"]);
    expect(arranged.ordered).toEqual(items);
  });
});
