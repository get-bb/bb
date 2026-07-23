import { describe, expect, it } from "vitest";
import {
  resolveToolsBreadcrumbs,
  resolveToolsDocumentTitle,
  resolveToolsSectionDefinition,
  TOOLS_NAV_ITEMS,
} from "@/components/tools/tools-navigation";

describe("resolveToolsBreadcrumbs", () => {
  it("uses one section identity contract for navigation and page chrome", () => {
    expect(
      TOOLS_NAV_ITEMS.map(({ id, label, icon, to }) => ({
        id,
        label,
        icon,
        to,
      })),
    ).toEqual([
      { id: "skills", label: "Skills", icon: "Zap", to: "/tools/skills" },
      {
        id: "plugins",
        label: "Plugins",
        icon: "ElectricPlugs",
        to: "/tools/plugins",
      },
      {
        id: "automations",
        label: "Automations",
        icon: "TimeSchedule",
        to: "/tools/automations",
      },
    ]);
    expect(
      resolveToolsSectionDefinition("/tools/skills/registry/x").label,
    ).toBe("Skills");
    expect(resolveToolsSectionDefinition("/tools/plugins/x").label).toBe(
      "Plugins",
    );
    expect(
      resolveToolsSectionDefinition("/tools/automations/project/x").label,
    ).toBe("Automations");
    expect(resolveToolsDocumentTitle("/tools/skills", "Installed")).toBe(
      "Installed · Skills",
    );
    expect(resolveToolsDocumentTitle("/tools/plugins/x", "Plugin")).toBe(
      "Plugin · Plugins",
    );
  });

  it("includes the selected collection tab", () => {
    expect(resolveToolsBreadcrumbs("/tools/skills", "?view=browse")).toEqual([
      { label: "Skills", to: "/tools/skills" },
      { label: "Browse" },
    ]);
    expect(resolveToolsBreadcrumbs("/tools/plugins")).toEqual([
      { label: "Plugins", to: "/tools/plugins" },
      { label: "Installed" },
    ]);
    expect(
      resolveToolsBreadcrumbs("/tools/automations", "?view=browse"),
    ).toEqual([
      { label: "Automations", to: "/tools/automations" },
      { label: "Browse" },
    ]);
  });

  it("makes every detail ancestor clickable and keeps the resource passive", () => {
    expect(
      resolveToolsBreadcrumbs(
        "/tools/skills/registry/vercel-labs%2Fskills%2Ffind-skills",
      ),
    ).toEqual([
      { label: "Skills", to: "/tools/skills" },
      { label: "Browse", to: "/tools/skills/registry" },
      { label: "find-skills" },
    ]);
    expect(resolveToolsBreadcrumbs("/tools/plugins/ui-patterns")).toEqual([
      { label: "Plugins", to: "/tools/plugins" },
      { label: "Installed", to: "/tools/plugins" },
      { label: "ui-patterns" },
    ]);
    expect(
      resolveToolsBreadcrumbs("/tools/plugins/ui-patterns", "", "UI Patterns"),
    ).toEqual([
      { label: "Plugins", to: "/tools/plugins" },
      { label: "Installed", to: "/tools/plugins" },
      { label: "UI Patterns" },
    ]);
    expect(
      resolveToolsBreadcrumbs("/tools/automations/personal/weekly-review/edit"),
    ).toEqual([
      { label: "Automations", to: "/tools/automations" },
      { label: "Installed", to: "/tools/automations" },
      {
        label: "weekly-review",
        to: "/tools/automations/personal/weekly-review",
      },
      { label: "Edit" },
    ]);
  });
});
