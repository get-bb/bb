import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { getTableOfContents } from "fumadocs-core/content/toc";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { surfaceDocsPath } from "../../../../plugins/plugin-api-docs/src/surface-docs";
import { SURFACE_GROUPS } from "../../../../plugins/plugin-api-docs/src/surfaces";
import { DOCS_NAV, navSectionOf, PLUGIN_SDK_SLUG } from "./nav";
import {
  DOCS_PAGE_TYPES,
  docsFrontmatterFields,
  templateProblems,
  type DocsPageType,
} from "./page-types";
import {
  cliReferencePage,
  referenceSource,
  SOURCES_HEADING,
} from "./reference";
import { codeBlockLabel } from "./docs-blocks";
import {
  DOCS_IMAGES_BASE,
  SHOT_PLACEHOLDER_PATTERN,
  screenshotFiles,
} from "./shot";

const WEB_ROOT = path.resolve(__dirname, "../..");
const CONTENT_DIR = path.join(WEB_ROOT, "content/docs");
const PUBLIC_DIR = path.join(WEB_ROOT, "public");
const SITE_ORIGIN = "https://getbb.app";
const NON_PAGE_DOCS_ROUTES = ["/docs/mcp", "/docs/search.json"];
const TEMPLATES_DIR = path.resolve(
  WEB_ROOT,
  "../../.bb/skills/docs-writing/templates",
);

const frontmatterSchema = z.object({
  title: z.string().min(1),
  ...docsFrontmatterFields,
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

function pageUrlOf(slug: string): string {
  return slug === "" ? "/docs" : `/docs/${slug}`;
}

function withoutCodeFences(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .filter((line) => {
      if (/^\s*(```|~~~)/u.test(line)) {
        inFence = !inFence;
        return false;
      }
      return !inFence;
    })
    .join("\n");
}

function linkTargets(markdown: string): string[] {
  const text = withoutCodeFences(markdown).replace(/`[^`\n]*`/gu, "");
  return [
    ...[...text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/gu)].map(
      (match) => match[1]!,
    ),
    ...[...text.matchAll(/\bhref=(?:"([^"]+)"|\{"([^"]+)"\})/gu)].map(
      (match) => (match[1] ?? match[2])!,
    ),
  ];
}

interface LinkablePage {
  url: string;
  markdown: string;
  anchors: ReadonlySet<string>;
}

function brokenLinks(
  page: LinkablePage,
  pages: ReadonlyMap<string, LinkablePage>,
): string[] {
  const problems: string[] = [];
  for (const raw of linkTargets(page.markdown)) {
    const target = raw.startsWith(`${SITE_ORIGIN}/docs`)
      ? raw.slice(SITE_ORIGIN.length)
      : raw;
    if (!target.startsWith("/docs") && !target.startsWith("#")) continue;
    const [pathPart = "", anchor] = target.split("#", 2);
    const pagePath = pathPart === "" ? page.url : pathPart.replace(/\/$/u, "");
    const resolvedUrl =
      pagePath === "/docs/index.md" ? "/docs" : pagePath.replace(/\.md$/u, "");
    if (NON_PAGE_DOCS_ROUTES.includes(pagePath) && anchor === undefined) {
      continue;
    }
    const linked = pages.get(resolvedUrl);
    if (!linked) {
      problems.push(`${raw}: no docs page at ${resolvedUrl}`);
    } else if (anchor !== undefined && !linked.anchors.has(anchor)) {
      problems.push(`${raw}: ${resolvedUrl} has no heading #${anchor}`);
    }
  }
  return problems;
}

function mdxLinkablePage(file: string): LinkablePage {
  const content = matter(readFileSync(file, "utf8")).content;
  return {
    url: pageUrlOf(slugOf(file)),
    markdown: content,
    anchors: new Set(
      getTableOfContents(content).map((item) => item.url.replace(/^#/u, "")),
    ),
  };
}

function referenceLinkablePages(): LinkablePage[] {
  return referenceSource.files.flatMap((file) =>
    file.type === "page"
      ? [
          {
            url: pageUrlOf(file.path.replace(/(\/?index)?\.md$/u, "")),
            markdown: file.data.markdown,
            anchors: new Set(
              file.data.structuredData.headings.map((heading) => heading.id),
            ),
          },
        ]
      : [],
  );
}

function jsxAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(
    `\\b${name}=(?:"([^"]*)"|\\{\\s*(\\d+)\\s*\\})`,
    "u",
  ).exec(tag);
  return match ? (match[1] ?? match[2]) : undefined;
}

function pngSize(file: string): { width: number; height: number } {
  const header = readFileSync(file).subarray(0, 24);
  if (header.toString("latin1", 1, 4) !== "PNG") {
    throw new Error(`${file} is not a PNG`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function screenshotProblems(markdown: string): string[] {
  const problems: string[] = [];
  const tags = withoutCodeFences(markdown).match(/<Screenshot\b[^>]*>/gu) ?? [];
  for (const tag of tags) {
    const src = jsxAttribute(tag, "src");
    const alt = jsxAttribute(tag, "alt");
    const width = Number(jsxAttribute(tag, "width"));
    const height = Number(jsxAttribute(tag, "height"));
    if (!src?.startsWith(`${DOCS_IMAGES_BASE}/`)) {
      problems.push(`${tag}: src must start with ${DOCS_IMAGES_BASE}/`);
      continue;
    }
    if (!alt || !/[.!?]$/u.test(alt.trim())) {
      problems.push(`${src}: alt text must be a full sentence`);
    }
    for (const file of Object.values(screenshotFiles(src))) {
      const onDisk = path.join(PUBLIC_DIR, file);
      if (!existsSync(onDisk)) {
        problems.push(`${file} is missing`);
        continue;
      }
      const size = pngSize(onDisk);
      if (size.width !== width * 2 || size.height !== height * 2) {
        problems.push(
          `${file} is ${size.width}×${size.height}; a 2× capture of ${width}×${height} is ${width * 2}×${height * 2}`,
        );
      }
    }
  }
  return problems;
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
    "%s follows its template",
    (_name, file) => {
      const source = readFileSync(file, "utf8");
      const parsed = matter(source);
      const frontmatter = frontmatterSchema.parse(parsed.data);
      expect(
        templateProblems(frontmatter.type, h2Headings(parsed.content)),
      ).toEqual([]);
      expect(source).not.toMatch(SHOT_PLACEHOLDER_PATTERN);
      const navPage = navPages.find((page) => page.slug === slugOf(file));
      expect(navPage?.title).toBe(frontmatter.title);
    },
  );
});

describe("page templates", () => {
  it.each(DOCS_PAGE_TYPES.map((type) => [type]))(
    "the %s template has its required headings",
    (type: DocsPageType) => {
      const parsed = matter(
        readFileSync(path.join(TEMPLATES_DIR, `${type}.mdx`), "utf8"),
      );
      expect(parsed.data.type).toBe(type);
      expect(Object.keys(parsed.data).sort()).toEqual(
        ["title", ...Object.keys(docsFrontmatterFields)].sort(),
      );
      expect(templateProblems(type, h2Headings(parsed.content))).toEqual([]);
    },
  );

  it("reports missing and misplaced headings", () => {
    expect(templateProblems("how-to", ["Steps", "Check it worked"])).toEqual([
      'missing "## Related troubleshooting"',
      'must end with "## Related troubleshooting"',
    ]);
  });

  it("blocks image placeholders", () => {
    expect('<Shot todo="Settings → Plugins" />').toMatch(
      SHOT_PLACEHOLDER_PATTERN,
    );
    expect("A Shotgun is not a placeholder").not.toMatch(
      SHOT_PLACEHOLDER_PATTERN,
    );
  });
});

describe("generated reference pages", () => {
  const pages = referenceSource.files.flatMap((file) =>
    file.type === "page" ? [file] : [],
  );

  it.each(pages.map((page) => [page.path, page]))(
    "%s follows the reference template",
    (_path, page) => {
      expect(page.data.type).toBe("reference");
      expect(
        templateProblems("reference", h2Headings(page.data.markdown)),
      ).toEqual([]);
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

describe("docs links", () => {
  const mdxPages = mdxFiles(CONTENT_DIR).map(mdxLinkablePage);
  const allPages = [...mdxPages, ...referenceLinkablePages()];
  const pagesByUrl = new Map(allPages.map((page) => [page.url, page]));

  it.each(allPages.map((page) => [page.url, page]))(
    "every /docs link and #anchor on %s resolves",
    (_url, page) => {
      expect(brokenLinks(page, pagesByUrl)).toEqual([]);
    },
  );

  it("reports links to missing pages and headings", () => {
    const target: LinkablePage = {
      url: "/docs/cli",
      markdown: "",
      anchors: new Set(["bb-thread"]),
    };
    const page: LinkablePage = {
      url: "/docs/example",
      markdown: [
        "## Setup",
        "[ok](/docs/cli#bb-thread) [md](/docs/cli.md) [here](#setup)",
        "[gone](/docs/nope) [bad anchor](https://getbb.app/docs/cli#bb-nope)",
        '<a href="#missing">x</a> [mcp](/docs/mcp) [site](/guides)',
        "```md",
        "[in a fence](/docs/ignored)",
        "```",
      ].join("\n"),
      anchors: new Set(["setup"]),
    };
    const pages = new Map([
      [target.url, target],
      [page.url, page],
    ]);
    expect(brokenLinks(page, pages)).toEqual([
      "/docs/nope: no docs page at /docs/nope",
      "https://getbb.app/docs/cli#bb-nope: /docs/cli has no heading #bb-nope",
      "#missing: /docs/example has no heading #missing",
    ]);
  });
});

describe("docs images", () => {
  it.each(
    mdxFiles(CONTENT_DIR).map((file) => [path.relative(WEB_ROOT, file), file]),
  )("every screenshot on %s has light and dark files at 2×", (_name, file) => {
    expect(screenshotProblems(readFileSync(file, "utf8"))).toEqual([]);
  });

  it("reports missing files and an alt text that is not a sentence", () => {
    expect(
      screenshotProblems(
        '<Screenshot src="/docs-images/none/shot" alt="Settings" width={10} height={10} />',
      ),
    ).toEqual([
      "/docs-images/none/shot: alt text must be a full sentence",
      "/docs-images/none/shot-light.png is missing",
      "/docs-images/none/shot-dark.png is missing",
    ]);
  });
});

describe("docs code blocks", () => {
  it("labels a block by its title, then its language", () => {
    expect(codeBlockLabel("bb.config.yaml", "yaml")).toBe("bb.config.yaml");
    expect(codeBlockLabel(undefined, "bash")).toBe("Terminal");
    expect(codeBlockLabel(undefined, "yaml")).toBe("YAML");
    expect(codeBlockLabel(undefined, "plaintext")).toBe("Text");
    expect(codeBlockLabel(" ", "mdx")).toBe("MDX");
  });
});
