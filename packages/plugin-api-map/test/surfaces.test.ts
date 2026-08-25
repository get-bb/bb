import { describe, expect, it } from "vitest";

import { ANATOMY_MANIFEST as anatomy } from "../src/index";
import { SURFACE_GROUPS, SURFACE_NUMBERS, SURFACES_BY_ID } from "../src/index";
import {
  ANATOMY_RENDERER_KEYS,
  APP_SHELL_MARKS,
  COMPOSE_MARKS,
  COMPOSER_MARKS,
  EXTENSIONS_MARKS,
  SETTINGS_MARKS,
} from "../src/index";

const groupById = new Map(SURFACE_GROUPS.map((group) => [group.id, group]));

function surfaceIds(groupId: string): string[] {
  return (groupById.get(groupId as never)?.surfaces ?? []).map(
    (surface) => surface.id,
  );
}

describe("product-map surfaces", () => {
  it("orders app-window annotations along one spatial scan path", () => {
    const ordered = [
      // Sidebar, top to bottom.
      "nav-panel",
      "thread-list",
      "thread-row-status",
      "sidebar-footer",
      // Main thread, top to bottom.
      "thread-header",
      "command-palette-actions",
      "timeline-renderers",
      "message-directives",
      "message-actions",
      "pending-interaction",
      // Right-panel tabs, left to right.
      "code-renderers",
      "thread-panel",
      "file-opener",
      // Whole-window behavior is the final, enclosing annotation.
      "content-scripts",
    ];
    expect(surfaceIds("app-shell")).toEqual(ordered);
    expect([...APP_SHELL_MARKS]).toEqual(ordered);
  });

  it("has globally unique surface ids", () => {
    const all = SURFACE_GROUPS.flatMap((group) =>
      group.surfaces.map((surface) => surface.id),
    );
    expect(new Set(all).size).toBe(all.length);
    expect(SURFACES_BY_ID.size).toBe(all.length);
  });

  it("marks every visual-group surface on its wireframe exactly once", () => {
    // One skeleton per carousel slide, so each group's surfaces must all be
    // marked on that group's own wireframe.
    expect([...APP_SHELL_MARKS].sort()).toEqual(surfaceIds("app-shell").sort());
    expect([...COMPOSER_MARKS].sort()).toEqual(surfaceIds("composer").sort());
    expect([...COMPOSE_MARKS].sort()).toEqual(surfaceIds("home").sort());
    expect([...SETTINGS_MARKS].sort()).toEqual(surfaceIds("settings").sort());
    expect([...EXTENSIONS_MARKS].sort()).toEqual(
      surfaceIds("extensions").sort(),
    );
  });

  it("numbers the surfaces a skeleton draws, and only those", () => {
    // A numbered surface with no marker would print a number the diagram
    // never shows; an unnumbered marked surface renders an empty chip.
    for (const group of SURFACE_GROUPS) {
      const numbers = group.surfaces.map((surface) =>
        SURFACE_NUMBERS.get(surface.id),
      );
      if (group.id === "headless") {
        expect(numbers.every((number) => number === undefined)).toBe(true);
        continue;
      }
      expect(numbers).toEqual(group.surfaces.map((_, index) => index + 1));
    }
  });

  it("renders every anatomy-manifest region and nothing else", () => {
    // The skeletons draw these regions by mapping over the manifest, so a
    // manifest key without a renderer would silently drop UI, and a stale
    // renderer key would be dead code hiding a manifest drift.
    for (const area of [
      "appSidebar",
      "sidebarFooter",
      "messageActionBar",
    ] as const) {
      expect([...ANATOMY_RENDERER_KEYS[area]].sort()).toEqual(
        [...anatomy[area]].sort(),
      );
    }
  });

  it("clusters every headless surface into exactly one named section", () => {
    // The pixel-less slide renders FROM these sections, so a surface missing
    // from them would silently vanish from the map.
    const headless = groupById.get("headless" as never);
    const sectioned = (headless?.sections ?? []).flatMap(
      (section) => section.surfaceIds,
    );
    expect([...sectioned].sort()).toEqual(surfaceIds("headless").sort());
    expect(new Set(sectioned).size).toBe(sectioned.length);
  });

  it("keeps the headless group off the wireframes", () => {
    const marked = new Set<string>([
      ...APP_SHELL_MARKS,
      ...COMPOSER_MARKS,
      ...COMPOSE_MARKS,
      ...SETTINGS_MARKS,
      ...EXTENSIONS_MARKS,
    ]);
    for (const id of surfaceIds("headless")) {
      expect(marked.has(id)).toBe(false);
    }
  });
});

describe("surface cross-references", () => {
  it("points every [label](id) at a real surface", () => {
    // An id that no longer exists renders as plain prose — the reference just
    // quietly disappears rather than failing, so nothing else would catch it.
    const dangling: string[] = [];
    for (const group of SURFACE_GROUPS) {
      for (const surface of group.surfaces) {
        for (const copy of [surface.summary, ...surface.bullets]) {
          for (const [, id] of copy.matchAll(/\[[^\]]+\]\(([a-z0-9-]+)\)/g)) {
            if (!SURFACES_BY_ID.has(id)) {
              dangling.push(`${surface.id}: "${id}"`);
            }
            if (id === surface.id) {
              dangling.push(`${surface.id}: references itself`);
            }
          }
        }
      }
    }
    expect(dangling).toEqual([]);
  });
});

describe("surface card copy", () => {
  it("follows the lead-then-bullets template", () => {
    // Every card reads the same way: one lead sentence that the bullets hang
    // off, then the capabilities. A lead that stops mid-thought (or bullets
    // that have nothing to hang off) reads as a broken card.
    for (const group of SURFACE_GROUPS) {
      for (const surface of group.surfaces) {
        expect(surface.summary, surface.id).toMatch(
          /\. With this, a plugin can:$/,
        );
        expect(surface.bullets.length, surface.id).toBeGreaterThanOrEqual(2);
        for (const bullet of surface.bullets) {
          expect(bullet.trim().length, surface.id).toBeGreaterThan(0);
          // The lead-in already says "can"; a bullet that repeats it reads
          // "a plugin can: Can register…". Bullets are bare verb phrases.
          expect(bullet, `${surface.id}: "${bullet}"`).not.toMatch(/^Can\b/);
        }
      }
    }
  });
});
