import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISTING_REPORT_URL,
  MARKETPLACE_CATALOG_URL,
  RESERVED_PLUGIN_IDS_URL,
  runPublishCheck,
  type PublishCheckEnvironment,
  type PublishCheckReport,
} from "../plugin-publish/check.js";
import {
  keywordsToTags,
  overviewMarkdownProblems,
  parseBbMarketplace,
  releaseTags,
  screenshotDataProblems,
} from "../plugin-publish/listing-rules.js";

const execFileAsync = promisify(execFile);
const categories = new Set(["utilities", "notifications", "security"]);

function png(width: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(800, 20);
  return buffer;
}

function jpeg(width: number): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    0x03,
    0x20,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);
}

describe("listing rules", () => {
  it("maps keywords to tags and reports the ones it drops", () => {
    expect(
      keywordsToTags([
        "bb-plugin",
        "BB",
        "Notes",
        "notes",
        "two words",
        "a".repeat(33),
        "under_score",
        7,
        ...Array.from({ length: 11 }, (_, index) => `tag-${index}`),
      ]),
    ).toEqual({
      tags: [
        "notes",
        "tag-0",
        "tag-1",
        "tag-2",
        "tag-3",
        "tag-4",
        "tag-5",
        "tag-6",
        "tag-7",
        "tag-8",
      ],
      dropped: [
        "two words",
        "a".repeat(33),
        "under_score",
        "7",
        "tag-9",
        "tag-10",
      ],
    });
  });

  it("requires a real category and rejects unknown bbMarketplace keys", () => {
    expect(parseBbMarketplace(undefined, categories).problems).toEqual([
      expect.objectContaining({ code: "missing-category" }),
    ]);
    expect(
      parseBbMarketplace({ category: "choose-a-category" }, categories)
        .problems,
    ).toEqual([expect.objectContaining({ code: "missing-category" })]);
    const parsed = parseBbMarketplace(
      {
        category: "utilities",
        secondaryCategories: ["utilities", "nope", "security", "security"],
        screenshot: ["./a.png"],
      },
      categories,
    );
    expect(parsed.problems.map((problem) => problem.code)).toEqual([
      "invalid-manifest",
      "invalid-manifest",
      "invalid-manifest",
      "unknown-category",
      "invalid-manifest",
    ]);
    expect(parsed.category).toBe("utilities");
    expect(parsed.secondaryCategories).toEqual(["security"]);
    expect(
      parseBbMarketplace({ category: "games" }, categories).problems,
    ).toEqual([expect.objectContaining({ code: "unknown-category" })]);
  });

  it("checks screenshot format, extension, and width", () => {
    expect(screenshotDataProblems("./wide.png", png(1600))).toEqual([]);
    expect(screenshotDataProblems("./narrow.png", png(800))).toEqual([
      "./narrow.png is 800 px wide. The minimum is 1200 px.",
    ]);
    expect(screenshotDataProblems("./photo.png", jpeg(1400))).toEqual([
      "./photo.png holds JPEG data, which does not match its extension.",
    ]);
    expect(screenshotDataProblems("./photo.jpg", jpeg(1400))).toEqual([]);
    expect(
      screenshotDataProblems("./text.webp", Buffer.from("not an image")),
    ).toEqual(["./text.webp is not a PNG, JPEG, or WebP image."]);
  });

  it("applies the marketplace overview markdown rules", () => {
    expect(
      overviewMarkdownProblems(
        "Lead.\n\n## What you get\n\n- **One** [link](https://example.com)\n\n```sh\n<b>ok in code</b>\n```\n",
      ),
    ).toEqual([]);
    expect(
      overviewMarkdownProblems(
        "<b>html</b>\n\n![shot](https://example.com/a.png)\n\n| a |\n| - |\n| b |\n\n- [ ] task\n\n[rel](./docs.md)\n",
      ),
    ).toEqual([
      "PLUGIN_OVERVIEW.md uses raw HTML at line 1.",
      "PLUGIN_OVERVIEW.md uses an image at line 3.",
      "PLUGIN_OVERVIEW.md uses a table at line 5.",
      "PLUGIN_OVERVIEW.md uses a task list at line 9.",
      'PLUGIN_OVERVIEW.md: The link "./docs.md" must be an absolute https URL. Line 11.',
    ]);
    expect(overviewMarkdownProblems("x".repeat(4001))).toEqual([
      "PLUGIN_OVERVIEW.md has 4001 characters. The maximum is 4000.",
    ]);
  });

  it("picks stable release tags for a prefix, highest first", () => {
    expect(
      releaseTags(
        ["v1.0.0", "1.2.0", "v1.10.0-beta.1", "notes/v2.0.0", "v01.0.0"],
        "",
      ).map((tag) => tag.tag),
    ).toEqual(["1.2.0", "v1.0.0"]);
    expect(
      releaseTags(["notes/v2.0.0", "notes/1.0.0", "v3.0.0"], "notes/"),
    ).toEqual([
      { tag: "notes/v2.0.0", version: "2.0.0" },
      { tag: "notes/1.0.0", version: "1.0.0" },
    ]);
  });
});

interface FakeWorld {
  responses: Map<string, { status: number; body: unknown }>;
  gh: Map<string, string>;
  npmPack: string | null;
}

function fakeEnvironment(world: FakeWorld): PublishCheckEnvironment {
  return {
    async run(command, args, cwd) {
      if (command === "git") {
        if (args[0] === "ls-remote") return { exitCode: 2, stdout: "" };
        try {
          const { stdout } = await execFileAsync("git", [...args], { cwd });
          return { exitCode: 0, stdout };
        } catch {
          return { exitCode: 1, stdout: "" };
        }
      }
      if (command === "gh") {
        const body = world.gh.get(args[1] ?? "");
        return body === undefined
          ? { exitCode: 1, stdout: "" }
          : { exitCode: 0, stdout: body };
      }
      if (command === "npm") {
        return world.npmPack === null
          ? { exitCode: 1, stdout: "" }
          : { exitCode: 0, stdout: world.npmPack };
      }
      return { exitCode: -1, stdout: "" };
    },
    async fetchJson(url) {
      return world.responses.get(url) ?? { status: 404, body: null };
    },
  };
}

function codes(report: PublishCheckReport): string[] {
  return report.findings.map(
    (finding) => `${finding.severity}:${finding.code}`,
  );
}

const validOverview =
  "Keep notes beside a thread.\n\n## What you get\n\n- A notes page.\n";

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function writePlugin(
  directory: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify(
      {
        name: "bb-plugin-notes",
        version: "1.0.0",
        keywords: ["bb-plugin", "notes"],
        bb: {
          name: "Notes",
          description: "Keep notes beside a thread.",
          branding: { icon: "NotebookPen" },
          server: "./server.ts",
        },
        bbMarketplace: {
          category: "utilities",
          screenshots: ["./screenshots/main.png"],
        },
        ...overrides,
      },
      null,
      2,
    ),
  );
  await writeFile(join(directory, "server.ts"), "export default () => {};\n");
  await writeFile(join(directory, "PLUGIN_OVERVIEW.md"), validOverview);
  await mkdir(join(directory, "screenshots"), { recursive: true });
  await writeFile(join(directory, "screenshots", "main.png"), png(1600));
}

async function initRepo(root: string, remote: string): Promise<void> {
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "user.email", "test@example.com");
  await git(root, "config", "user.name", "Test");
  await git(root, "config", "commit.gpgsign", "false");
  await git(root, "config", "tag.gpgsign", "false");
  await git(root, "remote", "add", "origin", remote);
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "init");
}

describe("bb plugin publish --check", () => {
  let root: string;
  let world: FakeWorld;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-publish-check-"));
    world = { responses: new Map(), gh: new Map(), npmPack: null };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("passes an untagged GitHub root plugin and prints topic and tag steps", async () => {
    await writePlugin(root);
    await initRepo(root, "git@github.com:acme/bb-plugin-notes.git");

    const report = await runPublishCheck({
      directory: root,
      source: null,
      offline: true,
      environment: fakeEnvironment(world),
    });

    expect(report.ok).toBe(true);
    expect(report.source).toBe("github");
    expect(report.sourceKey).toBe("github:acme/bb-plugin-notes");
    expect(codes(report)).toEqual(["info:offline", "warning:no-release-tag"]);
    expect(report.listing).toMatchObject({
      id: "notes",
      category: "utilities",
      tags: ["notes"],
      screenshots: ["./screenshots/main.png"],
      hasOverview: true,
    });
    expect(report.nextSteps.join("\n")).toContain(
      "gh repo edit acme/bb-plugin-notes --add-topic bb-plugin",
    );
    expect(report.nextSteps.join("\n")).toContain("git tag v1.0.0");
    expect(report.nextSteps.at(-1)).toContain(LISTING_REPORT_URL);
  });

  it("reports manifest, category, screenshot, icon, and overview failures with contract codes", async () => {
    await writePlugin(root, {
      bb: {
        name: "Notes",
        description: "Keep notes beside a thread.",
        branding: { icon: "./missing.svg" },
        server: "./server.ts",
      },
      bbMarketplace: {
        category: "games",
        screenshots: ["./screenshots/main.png", "../outside.png"],
        screenshot: [],
      },
    });
    await writeFile(join(root, "screenshots", "main.png"), png(640));
    await writeFile(join(root, "PLUGIN_OVERVIEW.md"), "<div>hi</div>\n");
    await initRepo(root, "https://github.com/acme/bb-plugin-notes.git");

    const report = await runPublishCheck({
      directory: root,
      source: null,
      offline: true,
      environment: fakeEnvironment(world),
    });

    expect(report.ok).toBe(false);
    expect(codes(report).filter((code) => code.startsWith("error:"))).toEqual([
      "error:invalid-manifest",
      "error:unknown-category",
      "error:invalid-screenshot",
      "error:invalid-screenshot",
      "error:invalid-icon",
      "error:invalid-overview",
    ]);
    expect(report.nextSteps[0]).toContain("Fix the errors above");
  });

  it("requires .bb/plugins.json for a subdirectory plugin and uses the basename tag prefix", async () => {
    const pluginDir = join(root, "plugins", "notes");
    await writePlugin(pluginDir, { name: "@acme/bb-plugin-notes" });
    await initRepo(root, "https://github.com/acme/plugins.git");

    const missing = await runPublishCheck({
      directory: pluginDir,
      source: null,
      offline: true,
      environment: fakeEnvironment(world),
    });
    expect(codes(missing)).toContain("error:no-manifest");
    expect(missing.github?.tagPrefix).toBe("notes/");

    await mkdir(join(root, ".bb"));
    await writeFile(
      join(root, ".bb", "plugins.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "acme",
        plugins: [{ name: "notes", source: "./plugins/notes" }],
      }),
    );
    await git(root, "add", "-A");
    await git(root, "commit", "-q", "-m", "collection");
    await git(root, "tag", "notes/v0.9.0", "HEAD~1");
    await git(root, "tag", "notes/v1.0.0");

    const tagged = await runPublishCheck({
      directory: pluginDir,
      source: null,
      offline: true,
      environment: fakeEnvironment(world),
    });
    expect(tagged.ok).toBe(true);
    expect(codes(tagged)).toEqual(["info:offline"]);
    expect(tagged.sourceKey).toBe("github:acme/plugins/plugins/notes");
    expect(tagged.github).toMatchObject({
      subdir: "plugins/notes",
      tagPrefix: "notes/",
      releaseTag: "notes/v1.0.0",
      headTag: "notes/v1.0.0",
    });
    expect(tagged.nextSteps.join("\n")).toContain(
      "git push origin notes/v1.0.0",
    );
  });

  it("checks the live catalog: takeover by the same owner, id-claimed otherwise, and the repository flags", async () => {
    await writePlugin(root);
    await initRepo(root, "https://github.com/acme/bb-plugin-notes.git");
    world.responses.set(RESERVED_PLUGIN_IDS_URL, {
      status: 200,
      body: { reservedPrefix: "bb--", bundledPluginIds: ["github"] },
    });
    world.gh.set(
      "repos/acme/bb-plugin-notes",
      JSON.stringify({ fork: true, archived: false, topics: ["notes"] }),
    );
    const catalog = (author: string) => ({
      categories: [{ id: "utilities" }],
      plugins: [
        {
          id: "notes",
          author: { name: author, github: author },
          source: {
            git: {
              url: `https://github.com/${author}/old-notes.git`,
              range: "^1.0.0",
            },
          },
        },
      ],
    });

    world.responses.set(MARKETPLACE_CATALOG_URL, {
      status: 200,
      body: catalog("Acme"),
    });
    const mine = await runPublishCheck({
      directory: root,
      source: null,
      offline: false,
      environment: fakeEnvironment(world),
    });
    expect(codes(mine)).toEqual([
      "warning:no-release-tag",
      "error:fork",
      "warning:not-opted-in",
      "info:replaces-listing",
    ]);

    world.responses.set(MARKETPLACE_CATALOG_URL, {
      status: 200,
      body: catalog("someone-else"),
    });
    const theirs = await runPublishCheck({
      directory: root,
      source: null,
      offline: false,
      environment: fakeEnvironment(world),
    });
    expect(codes(theirs)).toContain("error:id-claimed");
    expect(codes(theirs)).not.toContain("info:replaces-listing");
  });

  it("rejects bundled ids and bb-only categories from the live catalog", async () => {
    await writePlugin(root, {
      name: "bb-plugin-github",
      bbMarketplace: { category: "environments" },
    });
    await initRepo(root, "https://github.com/acme/bb-plugin-github.git");
    world.responses.set(RESERVED_PLUGIN_IDS_URL, {
      status: 200,
      body: { reservedPrefix: "bb--", bundledPluginIds: ["github"] },
    });
    world.responses.set(MARKETPLACE_CATALOG_URL, {
      status: 200,
      body: { categories: [{ id: "utilities" }], plugins: [] },
    });

    const report = await runPublishCheck({
      directory: root,
      source: null,
      offline: false,
      environment: fakeEnvironment(world),
    });
    expect(codes(report)).toEqual(
      expect.arrayContaining([
        "error:id-reserved",
        "error:unknown-category",
        "info:unknown-category",
      ]),
    );
  });

  it("checks that an npm tarball carries the listing assets", async () => {
    await writePlugin(root, { keywords: ["notes"] });
    world.npmPack = JSON.stringify([
      { files: [{ path: "package.json" }, { path: "server.ts" }] },
    ]);

    const report = await runPublishCheck({
      directory: root,
      source: null,
      offline: true,
      environment: fakeEnvironment(world),
    });
    expect(report.source).toBe("npm");
    expect(report.sourceKey).toBe("npm:bb-plugin-notes");
    expect(codes(report)).toEqual([
      "info:offline",
      "warning:not-opted-in",
      "error:invalid-overview",
      "error:invalid-screenshot",
    ]);
    expect(report.nextSteps.join("\n")).toContain(
      'Add "bb-plugin" to "keywords"',
    );
  });
});
