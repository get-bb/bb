// @vitest-environment jsdom

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Icon } from "@bb/shared-ui/icon";
import { setAppIcons } from "@bb/shared-ui/icon-registry";
import { PluginCompactIconMask } from "@/components/plugin/PluginIcon";

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!readdirSync(dir).includes("pnpm-workspace.yaml")) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("repo root not found");
    dir = parent;
  }
  return dir;
}

const ROOT = repoRoot();
const SCANNED_TREES = [
  "apps/app/src",
  "apps/web/src",
  "packages/shared-ui/src",
];

const STRUCTURAL_SVG_SELECTOR = /\[&[_>]svg[^\]]*\]:/g;

const ALLOWED_STRUCTURAL_SVG_FILES = new Set([
  "apps/app/src/components/ui/markdown-mermaid-diagram.tsx",
  "apps/app/src/components/ui/detail-card.stories.tsx",
  "packages/shared-ui/src/components/ui/chart.tsx",
  "packages/shared-ui/src/components/ui/calendar.tsx",
]);

function sourceFiles(tree: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(join(ROOT, tree));
  return out;
}

afterEach(() => {
  cleanup();
  setAppIcons(new Map());
});

describe("icon root marker", () => {
  it("marks exactly one element per icon shape", () => {
    function DuckGlyph({ className }: { className?: string }) {
      return <svg className={className} viewBox="0 0 24 24" />;
    }
    setAppIcons(
      new Map([["plugin/duck", { component: DuckGlyph, key: "duck-1" }]]),
    );

    const builtin = render(<Icon name="Settings" />);
    expect(builtin.container.querySelectorAll("[data-icon-root]")).toHaveLength(
      1,
    );
    cleanup();

    const custom = render(<Icon name="plugin/duck" />);
    expect(custom.container.querySelectorAll("[data-icon-root]")).toHaveLength(
      1,
    );
    expect(
      custom.container.querySelector("[data-icon-root]")?.tagName,
    ).toBe("SPAN");
    cleanup();

    const mask = render(<PluginCompactIconMask url="/duck.svg" />);
    expect(mask.container.querySelectorAll("[data-icon-root]")).toHaveLength(1);
  });

  it("resolves to one node for both child and descendant container rules", () => {
    function DuckGlyph({ className }: { className?: string }) {
      return <svg className={className} viewBox="0 0 24 24" />;
    }
    setAppIcons(
      new Map([["plugin/duck", { component: DuckGlyph, key: "duck-1" }]]),
    );

    const shapes = {
      builtin: <Icon name="Settings" />,
      custom: <Icon name="plugin/duck" />,
      mask: <PluginCompactIconMask url="/duck.svg" />,
    };

    for (const [shape, element] of Object.entries(shapes)) {
      const { container } = render(<div className="host">{element}</div>);
      const host = container.querySelector(".host");
      expect(host, shape).not.toBeNull();
      for (const selector of [
        ".host > [data-icon-root]",
        ".host [data-icon-root]",
      ]) {
        expect(
          container.querySelectorAll(selector).length,
          `${shape} ${selector}`,
        ).toBe(1);
      }
      cleanup();
    }
  });

  it("does not double-match the superseded svg-arm selector", () => {
    function DuckGlyph({ className }: { className?: string }) {
      return <svg className={className} viewBox="0 0 24 24" />;
    }
    setAppIcons(
      new Map([["plugin/duck", { component: DuckGlyph, key: "duck-1" }]]),
    );
    const { container } = render(
      <div className="host">
        <Icon name="plugin/duck" />
      </div>,
    );
    expect(
      container.querySelectorAll(".host :is(svg,[data-icon-root])").length,
    ).toBe(2);
    expect(container.querySelectorAll(".host [data-icon-root]").length).toBe(1);
  });
});

describe("structural svg selectors", () => {
  it("are not used to style icons outside the allowlist", () => {
    const offenders: string[] = [];
    for (const tree of SCANNED_TREES) {
      for (const file of sourceFiles(tree)) {
        const rel = relative(ROOT, file).split(sep).join("/");
        if (ALLOWED_STRUCTURAL_SVG_FILES.has(rel)) continue;
        if (/\.test\.tsx?$/.test(rel)) continue;
        const matches = readFileSync(file, "utf8").match(
          STRUCTURAL_SVG_SELECTOR,
        );
        if (matches !== null) offenders.push(`${rel}: ${matches.join(" ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist limited to non-icon svg content", () => {
    for (const rel of ALLOWED_STRUCTURAL_SVG_FILES) {
      const source = readFileSync(join(ROOT, rel), "utf8");
      expect(source.match(STRUCTURAL_SVG_SELECTOR), rel).not.toBeNull();
    }
  });
});
