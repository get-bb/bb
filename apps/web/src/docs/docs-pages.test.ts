import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DOCS_NAV, navSectionOf } from "./nav";

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
  it("has the 14 sections of the information architecture", () => {
    expect(DOCS_NAV.map((section) => section.label)).toEqual([
      "Get started",
      "Concepts",
      "Threads",
      "Child threads",
      "Automations, workflows and tasks",
      "Agents",
      "Skills",
      "Projects and environments",
      "Machines and servers",
      "Mobile and remote access",
      "Plugins",
      "Customization",
      "Reference",
      "Troubleshooting",
    ]);
  });

  it("gives every page one unique slug and title", () => {
    const slugs = navPages.map((page) => page.slug);
    const titles = navPages.map((page) => page.title);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("finds the section of a sidebar page", () => {
    expect(navSectionOf("cli")).toBe("Reference");
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
