import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineDocs } from "fumadocs-mdx/config";
import { dynamic } from "fumadocs-mdx/runtime/dynamic";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";

import {
  Callout,
  CalloutDescription,
  CalloutTitle,
  CodeBlock,
  codeCopyText,
  resolveTab,
  Tab,
  Tabs,
  tabGroupKey,
} from "./docs-blocks";
import { docsMdxOptions } from "./mdx-options";
import { Video } from "./shot";

const dir = mkdtempSync(path.join(tmpdir(), "bb-docs-mdx-"));
let pageCount = 0;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function compileDocsPage(source: string) {
  pageCount += 1;
  const file = path.join(dir, `page-${pageCount}.mdx`);
  writeFileSync(file, source);
  const runtime = await dynamic(
    {
      docs: defineDocs({
        dir,
        docs: {
          async: true,
          postprocess: { includeProcessedMarkdown: true },
          mdxOptions: docsMdxOptions,
        },
      }),
    },
    { environment: "test", outDir: dir },
  );
  const collection = await runtime.docs("docs", dir, {}, [
    {
      info: { path: path.basename(file), fullPath: file },
      data: { title: "Test" },
    },
  ]);
  const entry = collection.docs[0]!;
  const { body: Body } = await entry.load();
  return {
    markdown: await entry.getText("processed"),
    html: renderToStaticMarkup(
      <Body
        components={{
          pre: CodeBlock,
          Tabs,
          Tab,
          Callout,
          CalloutTitle,
          CalloutDescription,
          Video,
        }}
      />,
    ),
  };
}

describe("docs tabs", () => {
  const page = compileDocsPage(
    [
      "## Install",
      "",
      '<Tabs items={["Desktop", "CLI", "Phone"]}>',
      '<Tab value="Desktop">',
      "",
      "Open **Settings → Plugins**.",
      "",
      "</Tab>",
      '<Tab value="CLI">',
      "",
      "Run `bb plugin list`.",
      "",
      "</Tab>",
      '<Tab value="Phone">',
      "",
      "Tap **Plugins**.",
      "",
      "</Tab>",
      "</Tabs>",
      "",
      '```bash tab="macOS"',
      "brew install bb",
      "```",
      "",
      '```powershell tab="Windows"',
      "winget install bb",
      "```",
    ].join("\n"),
  );

  it("writes every panel to the Markdown copy under its tab label", async () => {
    const { markdown } = await page;
    expect(markdown).toContain(
      [
        "**Desktop:**",
        "",
        "Open **Settings → Plugins**.",
        "",
        "**CLI:**",
        "",
        "Run `bb plugin list`.",
        "",
        "**Phone:**",
        "",
        "Tap **Plugins**.",
      ].join("\n"),
    );
    expect(markdown).toMatch(
      /\*\*macOS:\*\*\n\n```bash[^\n]*\nbrew install bb/u,
    );
    expect(markdown).toMatch(
      /\*\*Windows:\*\*\n\n```powershell[^\n]*\nwinget install bb/u,
    );
    expect(markdown).not.toContain("<Tab");
  });

  it("renders every panel in the server HTML, with only the first shown", async () => {
    const { html } = await page;
    for (const text of ["Settings → Plugins", "bb plugin list", "Tap"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("winget");
    expect(html.match(/role="tabpanel"/gu)).toHaveLength(5);
    expect(html.match(/role="tabpanel"[^>]*hidden/gu)).toHaveLength(3);
  });

  it("opens the tab named in ?tab=, then the remembered one, then the first", () => {
    const items = ["Desktop", "CLI", "Phone"];
    expect(resolveTab(items, "?tab=cli", "Phone")).toBe("CLI");
    expect(resolveTab(items, "?tab=nope", "Phone")).toBe("Phone");
    expect(resolveTab(items, "", "Gone")).toBeUndefined();
    expect(resolveTab(["macOS", "Linux"], "?tab=MACOS", null)).toBe("macOS");
  });

  it("remembers a choice per tab group", () => {
    expect(tabGroupKey(["Desktop", "CLI"])).toBe("desktop|cli");
    expect(tabGroupKey(["Desktop", "CLI"], "surface")).toBe("surface");
  });
});

describe("docs callouts", () => {
  const page = compileDocsPage(
    [
      ":::warning",
      "Plugins get full trust.",
      "",
      "Install only plugins you trust.",
      ":::",
      "",
      ":::note[Unreleased]",
      "This ships in the next release.",
      ":::",
      "",
      "The meeting is at 10:30 in Settings:Plugins.",
    ].join("\n"),
  );

  it("become labelled blockquotes in the Markdown copy", async () => {
    const { markdown } = await page;
    expect(markdown).toContain(
      [
        "> **Warning:** Plugins get full trust.",
        ">",
        "> Install only plugins you trust.",
      ].join("\n"),
    );
    expect(markdown).toContain(
      "> **Note: Unreleased**\n>\n> This ships in the next release.",
    );
    expect(markdown).not.toContain(":::");
  });

  it("render one Callout per directive with its tone", async () => {
    const { html } = await page;
    expect(html).toContain('<aside class="docs-callout" data-tone="warning">');
    expect(html).toContain('<aside class="docs-callout" data-tone="note">');
    expect(html).toContain("Install only plugins you trust.");
    expect(html).toContain("Unreleased");
  });

  it("leave colons in ordinary text alone", async () => {
    const { html, markdown } = await page;
    expect(html).toContain("The meeting is at 10:30 in Settings:Plugins.");
    expect(markdown).toContain("The meeting is at 10:30 in Settings:Plugins.");
  });
});

describe("docs videos", () => {
  const page = compileDocsPage(
    [
      "Before.",
      "",
      '<Video src="/docs-videos/example/clip" title="Clip, step by step" width={1280} height={720} />',
      "",
      "After.",
    ].join("\n"),
  );

  it("become a link to the video and its text version in the Markdown copy", async () => {
    const { markdown } = await page;
    expect(markdown).toContain(
      "[Video: Clip, step by step](/docs-videos/example/clip.mp4) ([text version](/docs-videos/example/clip.txt))",
    );
    expect(markdown).not.toContain("<Video");
  });

  it("render a muted player with a poster, controls and no autoplay", async () => {
    const { html } = await page;
    expect(html).toContain('poster="/docs-videos/example/clip-poster.jpg"');
    expect(html).toContain("controls");
    expect(html).toContain("muted");
    expect(html).not.toContain("autoplay");
    expect(html).toContain('href="/docs-videos/example/clip.txt"');
  });
});

describe("docs code blocks", () => {
  it("copies shell commands without their prompts or output", () => {
    expect(
      codeCopyText(
        "$ bb thread list \\\n    --json\n[]\n$ bb status\nok\n",
        "bash",
      ),
    ).toBe("bb thread list \\\n    --json\nbb status");
    expect(codeCopyText("bb status\n", "sh")).toBe("bb status");
    expect(codeCopyText("$ not a prompt in YAML\n", "yaml")).toBe(
      "$ not a prompt in YAML",
    );
  });

  it("keeps Shiki's light and dark colours on every token", async () => {
    const { html } = await compileDocsPage(
      ['```bash title="Install"', "$ bb status", "```"].join("\n"),
    );
    expect(html).toContain("Install");
    expect(html).toMatch(/--shiki-light:#[0-9A-Fa-f]{6};--shiki-dark:#/u);
  });
});
