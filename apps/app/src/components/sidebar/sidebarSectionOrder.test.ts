import { describe, expect, it } from "vitest";
import {
  buildSidebarEntitySectionId,
  normalizeSidebarSectionOrder,
  reorderSidebarSectionOrder,
} from "./sidebarSectionOrder";

describe("normalizeSidebarSectionOrder", () => {
  const projectA = buildSidebarEntitySectionId("project", "a");
  const projectB = buildSidebarEntitySectionId("project", "b");

  it("expands the legacy aggregate section without changing its placement", () => {
    expect(
      normalizeSidebarSectionOrder({
        storedOrder: ["threads", "projects", "pinned"],
        entitySectionIds: [projectA, projectB],
        legacyEntityAnchor: "projects",
        hasPinnedSection: true,
      }),
    ).toEqual(["threads", projectA, projectB, "pinned"]);
  });

  it("preserves a free mixed order of built-ins and entities", () => {
    expect(
      normalizeSidebarSectionOrder({
        storedOrder: [projectB, "pinned", "threads", projectA],
        entitySectionIds: [projectA, projectB],
        legacyEntityAnchor: "projects",
        hasPinnedSection: true,
      }),
    ).toEqual([projectB, "pinned", "threads", projectA]);
  });

  it("drops removed entities and appends new ones after existing entities", () => {
    const projectC = buildSidebarEntitySectionId("project", "c");
    expect(
      normalizeSidebarSectionOrder({
        storedOrder: ["project:removed", "threads", projectB],
        entitySectionIds: [projectA, projectB, projectC],
        legacyEntityAnchor: "projects",
        hasPinnedSection: true,
      }),
    ).toEqual(["pinned", "threads", projectB, projectA, projectC]);
  });

  it("uses the same reconciliation for folders", () => {
    const folder = buildSidebarEntitySectionId("folder", "work");
    expect(
      normalizeSidebarSectionOrder({
        storedOrder: ["pinned", "folders", "threads"],
        entitySectionIds: [folder],
        legacyEntityAnchor: "folders",
        hasPinnedSection: true,
      }),
    ).toEqual(["pinned", folder, "threads"]);
  });
});

describe("reorderSidebarSectionOrder", () => {
  it("moves any entity or built-in section through the shared order", () => {
    expect(
      reorderSidebarSectionOrder({
        activeId: "threads",
        overId: "project:a",
        order: ["pinned", "project:a", "project:b", "threads"],
      }),
    ).toEqual(["pinned", "threads", "project:a", "project:b"]);
  });

  it("rejects ids outside the top-level section contract", () => {
    expect(
      reorderSidebarSectionOrder({
        activeId: "thread:a",
        overId: "project:a",
        order: ["project:a", "threads"],
      }),
    ).toBeNull();
  });
});
