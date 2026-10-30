import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { APP_COMMAND_GROUPS } from "@bb/domain";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { surfaceDocsPath } from "../../../../plugins/plugin-api-docs/src/surface-docs";
import { SURFACE_GROUPS } from "../../../../plugins/plugin-api-docs/src/surfaces";
import { DOCS_NAV, navSectionOf, PLUGIN_SDK_SLUG } from "./nav";
import {
  cliReferencePage,
  keyboardReferencePage,
  referenceSource,
  SOURCES_HEADING,
} from "./reference";

const WEB_ROOT = path.resolve(__dirname, "../..");
const CONTENT_DIR = path.join(WEB_ROOT, "content/docs");

const frontmatterSchema = z.object({
  title: z.string().min(1),
});

function mdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(entryPath);
    return entry.name.endsWith(".mdx") ? [entryPath] : [];
  });
}

function h2Headings(markdown: string): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/u.test(line)) inFence = !inFence;
    const heading = /^## (.+)$/u.exec(line);
    if (!inFence && heading) headings.push(heading[1]!.trim());
  }
  return headings;
}

function slugOf(file: string): string {
  const relative = path
    .relative(CONTENT_DIR, file)
    .replace(/\.mdx$/u, "")
    .split(path.sep);
  if (relative.at(-1) === "index") relative.pop();
  return relative.join("/");
}

const navPages = DOCS_NAV.flatMap((section) => section.pages);

describe("docs sidebar", () => {
  it("gives every page one unique slug and title", () => {
    const slugs = navPages.map((page) => page.slug);
    const titles = navPages.map((page) => page.title);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("puts plugin surface pages under Reference", () => {
    expect(navSectionOf(`${PLUGIN_SDK_SLUG}/thread-panel`)).toBe("Reference");
    expect(navSectionOf("not-a-page")).toBeNull();
  });
});

describe("hand-written docs pages", () => {
  const files = mdxFiles(CONTENT_DIR);

  it.each(files.map((file) => [path.relative(WEB_ROOT, file), file]))(
    "%s is in the sidebar under its title",
    (_name, file) => {
      const parsed = matter(readFileSync(file, "utf8"));
      const frontmatter = frontmatterSchema.parse(parsed.data);
      const navPage = navPages.find((page) => page.slug === slugOf(file));
      expect(navPage?.title).toBe(frontmatter.title);
    },
  );
});

describe("generated reference pages", () => {
  const pages = referenceSource.files.flatMap((file) =>
    file.type === "page" ? [file] : [],
  );

  it.each(pages.map((page) => [page.path, page]))(
    "%s follows the reference template",
    (_path, page) => {
      expect(page.data.type).toBe("reference");
      expect(h2Headings(page.data.markdown).at(-1)).toBe(SOURCES_HEADING);
    },
  );

  it("lists every CLI command from the command index", () => {
    const commands = [
      {
        aliases: ["ls"],
        arguments: "[id]",
        description: "List | show things",
        options: ["--json", "--host <id>"],
        path: "thread list",
      },
      {
        aliases: [],
        arguments: "",
        description: "Show status",
        options: [],
        path: "status",
      },
    ];
    const page = cliReferencePage(commands);
    expect(h2Headings(page.markdown)).toEqual([
      "bb thread",
      "bb status",
      SOURCES_HEADING,
    ]);
    expect(page.markdown).toContain(
      "| `bb thread list [id]` (also `ls`) | List \\| show things | `--json` `--host <id>` |",
    );
  });

  it("lists every keyboard command with its app label", () => {
    const page = keyboardReferencePage();
    for (const group of APP_COMMAND_GROUPS) {
      expect(h2Headings(page.markdown)).toContain(group.label);
      for (const command of group.commands) {
        expect(page.markdown).toContain(`| ${command.label} |`);
      }
    }
  });

  it("has one page for every plugin surface, at the path Plugin Guide cards link to", () => {
    const pagePaths = new Set(pages.map((page) => `/docs/${page.path}`));
    for (const group of SURFACE_GROUPS) {
      for (const surface of group.surfaces) {
        expect(pagePaths).toContain(`${surfaceDocsPath(surface.id)}.md`);
      }
    }
    expect(pagePaths).toContain(`/docs/${PLUGIN_SDK_SLUG}/index.md`);
  });

  it("only places generated pages that are in the sidebar", () => {
    for (const page of pages) {
      const slug = page.path.replace(/(\/index)?\.md$/u, "");
      expect(navSectionOf(slug)).not.toBeNull();
    }
  });
});
