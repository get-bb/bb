import { describe, expect, it } from "vitest";
import {
  resolveToolsBreadcrumbs,
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
    ]);
  });

  it("includes the selected collection tab", () => {
    expect(resolveToolsBreadcrumbs("/tools/skills")).toEqual([
      { label: "Skills", to: "/tools/skills" },
      { label: "Library" },
    ]);
    expect(resolveToolsBreadcrumbs("/tools/skills", "?view=browse")).toEqual([
      { label: "Skills", to: "/tools/skills" },
      { label: "Browse" },
    ]);
    expect(resolveToolsBreadcrumbs("/tools/plugins")).toEqual([
      { label: "Plugins", to: "/tools/plugins" },
      { label: "Installed" },
    ]);
  });

  it("resolves literal browse paths as Browse, not as a resource named browse", () => {
    // /tools/plugins/:pluginId also matches /tools/plugins/browse, so if the
    // detail patterns are tested first this reads "Plugins / Installed /
    // browse" and the document title becomes "browse · Plugins".
    expect(resolveToolsBreadcrumbs("/tools/plugins/browse")).toEqual([
      { label: "Plugins", to: "/tools/plugins" },
      { label: "Browse" },
    ]);
    expect(resolveToolsBreadcrumbs("/tools/skills/registry")).toEqual([
      { label: "Skills", to: "/tools/skills" },
      { label: "Browse" },
    ]);
  });

  it("makes every detail ancestor clickable and keeps the resource passive", () => {
    expect(
      resolveToolsBreadcrumbs(
        "/tools/skills/library/skill_abc123",
        "",
        "Example Skill",
      ),
    ).toEqual([
      { label: "Skills", to: "/tools/skills" },
      { label: "Library", to: "/tools/skills" },
      { label: "Example Skill" },
    ]);
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
      resolveToolsBreadcrumbs(
        "/plugins/automations/automations/personal/weekly-review",
      ),
    ).toBeNull();
  });
});
