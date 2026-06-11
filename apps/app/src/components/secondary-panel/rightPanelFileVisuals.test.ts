import { describe, expect, it } from "vitest";
import { resolveRightPanelFileVisual } from "./rightPanelFileVisuals";

describe("resolveRightPanelFileVisual", () => {
  it("labels markdown plans and html mockups under plans/", () => {
    expect(
      resolveRightPanelFileVisual({ path: "plans/swap-model.md" }),
    ).toEqual({
      iconName: "File",
      label: "Plan",
    });
    expect(
      resolveRightPanelFileVisual({ path: "plans/sidebar-mockup.html" }),
    ).toEqual({
      iconName: "AppWindow",
      label: "Mockup",
    });
  });

  it("reads supported files under reports/ as reports", () => {
    expect(
      resolveRightPanelFileVisual({ path: "reports/architecture.md" }),
    ).toEqual({
      iconName: "ChartColumn",
      label: "Report",
    });
    expect(
      resolveRightPanelFileVisual({ path: "reports/desktop-size.html" }),
    ).toEqual({
      iconName: "ChartColumn",
      label: "Report",
    });
  });

  it("treats source files as code and bare markdown as a doc", () => {
    expect(
      resolveRightPanelFileVisual({
        path: "apps/app/src/components/secondary-panel/NewTabFileSearch.tsx",
      }),
    ).toEqual({ iconName: "Code", label: "Source" });
    expect(resolveRightPanelFileVisual({ path: "README.md" })).toEqual({
      iconName: "File",
      label: "Doc",
    });
  });
});
