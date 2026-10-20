import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { docsContent, readDocsCorpus } from "../../scripts/docs-content";
import { remarkDocContent } from "./markdown";

const directories: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "bb-docs-"));
  directories.push(root);
  for (const dir of [
    "src/docs/content",
    "public",
    "src/guides/pages",
    "src/routes",
    "src/landing/pages",
    "src/compare/pages",
  ]) {
    await mkdir(path.join(root, dir), { recursive: true });
  }
  const options = {
    contentDir: path.join(root, "src/docs/content"),
    publicDir: path.join(root, "public"),
    guideSlugs: new Set(["agent-browser"]),
    sitePaths: new Set(["/plugin-guide"]),
  };
  const write = (
    slug: string,
    body: string,
    metadata: Record<string, unknown> = {},
  ) =>
    writeFile(
      path.join(options.contentDir, `${slug}.md`),
      `---\n${JSON.stringify({
        title: "Example",
        description: "An example",
        section: "extend-bb",
        order: 10,
        status: "published",
        updated: "2026-10-21",
        relatedGuides: [],
        relatedDocs: [],
        redirectFrom: [],
        media: {},
        ...metadata,
      })}\n---\n${body}`,
    );
  return { root, options, write };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("docs content boundary", () => {
  it.each([
    [{ updated: "2026-02-30" }, "calendar date"],
    [{ section: "missing" }, "Unknown docs section"],
    [{ relatedDocs: ["missing"] }, "Related doc is missing"],
    [{ relatedGuides: ["missing"] }, "Unknown related guide"],
    [{ redirectFrom: ["/docs/example"] }, "Redirect collision"],
    [{ media: { demo: { kind: "video" } } }, "Invalid frontmatter"],
  ])("rejects invalid metadata %j", async (metadata, message) => {
    const { options, write } = await fixture();
    await write("example", "Example body.", metadata);
    await expect(readDocsCorpus(options)).rejects.toThrow(message);
  });

  it.each([
    ["# Wrong title", "body headings start at H2"],
    ["<script>alert(1)</script>", "Raw HTML"],
    [":::warning\nUnsupported\n:::", "Only :::note"],
    [":::note{onclick=bad}\nUnsupported\n:::", "Only :::note"],
    ["[Bad](javascript:alert)", "Unsafe or unsupported URL"],
    ["[Bad](//example.com)", "Unsafe or unsupported URL"],
    ["[Bad](/docs/missing)", "Doc link is missing"],
    ["[Bad](#missing)", "Unknown heading anchor"],
    ["![Bad](/missing.png)", "missing asset"],
    ["[Bad](/guides/missing)", "Unknown guide link"],
  ])("rejects malformed body %s", async (body, message) => {
    const { options, write } = await fixture();
    await write("example", body);
    await expect(readDocsCorpus(options)).rejects.toThrow(message);
  });

  it("rejects executable frontmatter languages before parsing", async () => {
    const { options } = await fixture();
    await writeFile(
      path.join(options.contentDir, "example.md"),
      "---js\nthrow new Error('EXECUTED_FRONTMATTER')\n---\nBody",
    );
    await expect(readDocsCorpus(options)).rejects.toThrow(
      "Expected YAML frontmatter",
    );
  });

  it("rejects duplicate ordering and competing redirects", async () => {
    const { options, write } = await fixture();
    await write("first", "First", { redirectFrom: ["/docs/old"] });
    await write("second", "Second", { redirectFrom: ["/docs/old"] });
    await expect(readDocsCorpus(options)).rejects.toThrow("Duplicate order");
    await write("second", "Second", { order: 20, redirectFrom: ["/docs/old"] });
    await expect(readDocsCorpus(options)).rejects.toThrow("Redirect collision");
  });

  it("extracts the same duplicate and formatted heading anchors that readers receive", async () => {
    const { options, write } = await fixture();
    const body =
      "## Hello *world* `code`\n\n## Hello *world* `code`\n\n### Café & tea\n\n[Jump](#hello-world-code-1)\n\n:::note\nA useful note.\n:::";
    await write("example", body);
    const { docs } = await readDocsCorpus(options);
    expect(docs[0].meta.headings).toEqual([
      { id: "hello-world-code", text: "Hello world code", depth: 2 },
      { id: "hello-world-code-1", text: "Hello world code", depth: 2 },
      { id: "café--tea", text: "Café & tea", depth: 3 },
    ]);
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, {
        remarkPlugins: [remarkGfm, remarkDirective, remarkDocContent],
        children: body,
      }),
    );
    expect(html).toContain('<h2 id="hello-world-code-1">');
    expect(html).toContain('<h3 id="café--tea">');
    expect(html).toContain('<aside class="docs-note">');
  });

  it("discovers added pages and validates links across published pages and assets", async () => {
    const { options, write } = await fixture();
    await write(
      "first",
      "## First\n\n[Next](/docs/old#next)\n\n![Screen](/screen.svg)",
      { relatedDocs: ["next"], relatedGuides: ["agent-browser"] },
    );
    await writeFile(
      path.join(options.publicDir, "screen.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    await write("next", "## Next", { order: 20, redirectFrom: ["/docs/old"] });
    expect(
      (await readDocsCorpus(options)).docs.map((doc) => doc.meta.slug),
    ).toEqual(["first", "next"]);
    await write("new-page", "New page", { order: 30 });
    expect(
      (await readDocsCorpus(options)).docs.map((doc) => doc.meta.slug),
    ).toEqual(["first", "next", "new-page"]);
    await write("next", "## Next", { order: 20, status: "draft" });
    await expect(readDocsCorpus(options)).rejects.toThrow(
      "Related doc is missing or unpublished",
    );
  });

  it("excludes draft bytes from emitted browser and server artifacts and keeps bodies lazy", async () => {
    const { root, write } = await fixture();
    await write("visible", "PUBLISHED_BODY_SENTINEL");
    await write("private-draft", "PRIVATE_DRAFT_SENTINEL", {
      status: "draft",
      order: 20,
    });
    const entry = path.join(root, "entry.ts");
    const docsModule = fileURLToPath(new URL("./docs.ts", import.meta.url));
    await writeFile(
      entry,
      `export { DOCS, getDoc } from ${JSON.stringify(docsModule)};`,
    );
    async function artifacts(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      return (
        await Promise.all(
          entries.map((item) =>
            item.isDirectory()
              ? artifacts(path.join(dir, item.name))
              : readFile(path.join(dir, item.name), "utf8").then((body) => [
                  body,
                ]),
          ),
        )
      ).flat();
    }
    for (const ssr of [false, true]) {
      const outDir = path.join(root, ssr ? "server" : "browser");
      await build({
        configFile: false,
        root,
        plugins: [docsContent()],
        logLevel: "silent",
        build: {
          ssr,
          outDir,
          minify: false,
          rollupOptions: { input: entry, preserveEntrySignatures: "strict" },
        },
      });
      const output = await artifacts(outDir);
      expect(output.join("\n")).not.toContain("PRIVATE_DRAFT_SENTINEL");
      expect(output.join("\n")).not.toContain("private-draft");
      expect(output.join("\n")).toContain("PUBLISHED_BODY_SENTINEL");
      const metadataChunk = output.find((body) =>
        body.includes('"/docs/visible"'),
      );
      expect(metadataChunk).toBeDefined();
      expect(metadataChunk).not.toContain("PUBLISHED_BODY_SENTINEL");
    }
  }, 30_000);
});
