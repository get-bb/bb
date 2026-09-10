import { describe, expect, it } from "vitest";
import {
  resolveAutomationBreadcrumbs,
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
      { label: "Installed", to: "/plugins?view=installed" },
      { label: "UI Patterns" },
    ]);
    expect(
      resolveToolsBreadcrumbs(
        "/plugins/automations/automations/personal/weekly-review",
      ),
    ).toBeNull();
  });
});

describe("resolveAutomationBreadcrumbs", () => {
  it("maps the installed and browse surfaces to automation breadcrumbs", () => {
    expect(
      resolveAutomationBreadcrumbs("/plugins/automations/automations"),
    ).toEqual([
      {
        label: "Automations",
        to: "/plugins/automations/automations",
      },
      { label: "Installed" },
    ]);
    expect(
      resolveAutomationBreadcrumbs("/plugins/automations/automations/browse"),
    ).toEqual([
      {
        label: "Automations",
        to: "/plugins/automations/automations",
      },
      { label: "Browse" },
    ]);
  });

  it("keeps detail ancestors clickable and replaces the loading fallback label", () => {
    const detailPath =
      "/plugins/automations/automations/proj_personal/weekly-review";

    expect(resolveAutomationBreadcrumbs(detailPath)).toEqual([
      {
        label: "Automations",
        to: "/plugins/automations/automations",
      },
      {
        label: "Installed",
        to: "/plugins/automations/automations",
      },
      { label: "weekly-review" },
    ]);
    expect(resolveAutomationBreadcrumbs(detailPath, "Weekly review")).toEqual([
      {
        label: "Automations",
        to: "/plugins/automations/automations",
      },
      {
        label: "Installed",
        to: "/plugins/automations/automations",
      },
      { label: "Weekly review" },
    ]);
    expect(
      resolveAutomationBreadcrumbs(`${detailPath}/edit`, "Weekly review"),
    ).toEqual([
      {
        label: "Automations",
        to: "/plugins/automations/automations",
      },
      {
        label: "Installed",
        to: "/plugins/automations/automations",
      },
      { label: "Weekly review" },
    ]);
  });

  it("uses the route id when automation data is missing", () => {
    expect(
      resolveAutomationBreadcrumbs(
        "/plugins/automations/automations/proj_personal/missing%20automation",
      )?.at(-1),
    ).toEqual({ label: "missing automation" });
  });

  it("does not claim unrelated plugin routes", () => {
    expect(
      resolveAutomationBreadcrumbs("/plugins/simple-notes/simple-notes"),
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
