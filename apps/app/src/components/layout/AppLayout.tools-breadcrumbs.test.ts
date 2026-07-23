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
      {
        id: "automations",
        label: "Automations",
        icon: "TimeSchedule",
        to: "/tools/automations",
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
