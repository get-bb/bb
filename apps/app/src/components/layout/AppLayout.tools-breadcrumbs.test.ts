import { describe, expect, it } from "vitest";
import {
  resolvePluginsWorkspaceHeaderMeta,
  resolveSkillsWorkspaceHeaderMeta,
  resolveToolsBreadcrumbs,
} from "@/components/tools/tools-navigation";

describe("resolveToolsBreadcrumbs", () => {
  it("includes the selected collection tab", () => {
    expect(resolveToolsBreadcrumbs("/skills")).toEqual([
      { label: "Skills", to: "/skills" },
      { label: "Browse" },
    ]);
    expect(resolveToolsBreadcrumbs("/skills", "?view=library")).toEqual([
      { label: "Skills", to: "/skills" },
      { label: "My skills" },
    ]);
    expect(resolveToolsBreadcrumbs("/plugins")).toEqual([
      { label: "Plugins", to: "/plugins" },
      { label: "Browse" },
    ]);
    expect(resolveToolsBreadcrumbs("/plugins", "?view=create")).toEqual([
      { label: "Plugins", to: "/plugins" },
      { label: "Create a plugin" },
    ]);
    expect(resolveToolsBreadcrumbs("/plugins", "?view=installed")).toEqual([
      { label: "Plugins", to: "/plugins" },
      { label: "Installed" },
    ]);
  });

  it("resolves the Skills registry path as Browse", () => {
    expect(resolveToolsBreadcrumbs("/skills/registry")).toEqual([
      { label: "Skills", to: "/skills" },
      { label: "Browse" },
    ]);
  });

  it("makes every detail ancestor clickable and keeps the resource passive", () => {
    expect(
      resolveToolsBreadcrumbs(
        "/skills/library/skill_abc123",
        "",
        "Example Skill",
      ),
    ).toEqual([
      { label: "Skills", to: "/skills" },
      { label: "My skills", to: "/skills?view=library" },
      { label: "Example Skill" },
    ]);
    expect(
      resolveToolsBreadcrumbs(
        "/skills/registry/vercel-labs%2Fskills%2Ffind-skills",
      ),
    ).toEqual([
      { label: "Skills", to: "/skills" },
      { label: "Browse", to: "/skills/registry" },
      { label: "find-skills" },
    ]);
    expect(resolveToolsBreadcrumbs("/plugins/ui-patterns")).toEqual([
      { label: "Plugins", to: "/plugins" },
      { label: "Browse", to: "/plugins" },
      { label: "ui-patterns" },
    ]);
    expect(
      resolveToolsBreadcrumbs(
        "/plugins/ui-patterns",
        "?view=installed",
        "UI Patterns",
      ),
    ).toEqual([
      { label: "Plugins", to: "/plugins" },
      { label: "Installed", to: "/settings/plugins" },
      { label: "UI Patterns" },
    ]);
    expect(
      resolveToolsBreadcrumbs(
        "/plugins/automations/automations/personal/weekly-review",
      ),
    ).toBeNull();
  });
});


describe("resource workspace headers", () => {
  it("gives Plugins ownership of only the Plugins header", () => {
    expect(
      resolvePluginsWorkspaceHeaderMeta(
        "/plugins?view=installed".split("?")[0]!,
      ),
    ).toEqual({ kind: "section-title", title: "Plugins" });
    expect(resolvePluginsWorkspaceHeaderMeta("/skills/registry")).toBeNull();
  });

  it("gives Skills ownership of only the Skills header", () => {
    expect(resolveSkillsWorkspaceHeaderMeta("/skills/registry")).toEqual({
      kind: "section-title",
      title: "Skills",
    });
    expect(resolveSkillsWorkspaceHeaderMeta("/plugins")).toBeNull();
  });

  it("keeps plugin creation inside the Plugins header", () => {
    expect(
      resolvePluginsWorkspaceHeaderMeta("/plugins", "?view=create"),
    ).toEqual({
      kind: "breadcrumbs",
      breadcrumbs: [
        { label: "Plugins", to: "/plugins" },
        { label: "Create a plugin" },
      ],
    });
  });

  it("claims nothing outside either resource workspace", () => {
    expect(resolvePluginsWorkspaceHeaderMeta("/")).toBeNull();
    expect(resolveSkillsWorkspaceHeaderMeta("/")).toBeNull();
  });
});
