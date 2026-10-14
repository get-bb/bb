import { fuzzyMatchPaths } from "@bb/fuzzy-match";
import { describe, expect, it } from "vitest";
import {
  finalizeListedFiles,
  finalizeListedPaths,
  normalizeListedPath,
} from "./file-list.js";

const signal = new AbortController().signal;

describe("finalizeListedFiles", () => {
  it("preserves walk order for an empty query", async () => {
    const result = await finalizeListedFiles({
      filePaths: ["src/z.ts", "src/a.ts", "src/m.ts"],
      limit: 2,
      signal,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "src/z.ts",
      "src/a.ts",
    ]);
    expect(result.truncated).toBe(true);
  });

  it("sets the display name from the path basename", async () => {
    const result = await finalizeListedFiles({
      filePaths: ["src/components/PromptBox.tsx"],
      limit: 5,
      signal,
    });

    expect(result.files).toEqual([
      {
        path: "src/components/PromptBox.tsx",
        name: "PromptBox.tsx",
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("does not report truncation exactly at the limit", async () => {
    const result = await finalizeListedFiles({
      filePaths: ["a.ts", "b.ts", "c.ts"],
      limit: 3,
      signal,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("applies query matching before truncating", async () => {
    const result = await finalizeListedFiles({
      filePaths: [
        "src/a.ts",
        "src/b.ts",
        "apps/app/src/components/promptbox/PromptBox.tsx",
      ],
      query: "PromptBox",
      limit: 1,
      signal,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "apps/app/src/components/promptbox/PromptBox.tsx",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("reports truncation after query matching when more matches remain", async () => {
    const result = await finalizeListedFiles({
      filePaths: ["src/prompt-a.ts", "src/prompt-b.ts", "src/prompt-c.ts"],
      query: "prompt",
      limit: 2,
      signal,
    });

    expect(result.files).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("returns an empty untruncated list when a query has no matches", async () => {
    const result = await finalizeListedFiles({
      filePaths: ["src/a.ts", "src/b.ts"],
      query: "prompt",
      limit: 2,
      signal,
    });

    expect(result.files).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe("finalizeListedPaths", () => {
  it("excludes directories when directory results are disabled", async () => {
    const result = await finalizeListedPaths({
      paths: [
        { kind: "directory", path: "src", name: "src" },
        { kind: "file", path: "src/index.ts", name: "index.ts" },
      ],
      includeFiles: true,
      includeDirectories: false,
      limit: 10,
      signal,
    });

    expect(result.paths).toEqual([
      {
        kind: "file",
        path: "src/index.ts",
        name: "index.ts",
        score: 0,
        positions: [],
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("includes directories with typed path metadata when requested", async () => {
    const result = await finalizeListedPaths({
      paths: [
        { kind: "directory", path: "src", name: "src" },
        { kind: "file", path: "src/index.ts", name: "index.ts" },
      ],
      includeFiles: true,
      includeDirectories: true,
      limit: 10,
      signal,
    });

    expect(result.paths.map((pathEntry) => pathEntry.kind)).toEqual([
      "directory",
      "file",
    ]);
    expect(result.paths[0]).toEqual({
      kind: "directory",
      path: "src",
      name: "src",
      score: 0,
      positions: [],
    });
  });

  it("applies fuzzy ranking before truncating mixed path results", async () => {
    const result = await finalizeListedPaths({
      paths: [
        {
          kind: "file",
          path: "src/components/Button.tsx",
          name: "Button.tsx",
        },
        {
          kind: "directory",
          path: "apps/app/src/components/promptbox",
          name: "promptbox",
        },
        {
          kind: "file",
          path: "apps/app/src/components/promptbox/PromptBox.tsx",
          name: "PromptBox.tsx",
        },
      ],
      query: "prompt",
      includeFiles: true,
      includeDirectories: true,
      limit: 1,
      signal,
    });

    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.path).toBe(
      "apps/app/src/components/promptbox/PromptBox.tsx",
    );
    expect(result.paths[0]?.score).toBeGreaterThan(0);
    expect(result.paths[0]?.positions.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });
});

interface LargeListedPath {
  kind: "file" | "directory";
  path: string;
  name: string;
}

function createLargeListing(): LargeListedPath[] {
  const paths: LargeListedPath[] = [];
  for (let repo = 0; repo < 20; repo += 1) {
    for (let pkg = 0; pkg < 50; pkg += 1) {
      const dir = `vendor/repo-${repo}/packages/pkg-${pkg}/src`;
      paths.push({ kind: "directory", path: dir, name: "src" });
      for (let file = 0; file < 25; file += 1) {
        const name = file === 0 ? "index.ts" : `file-${file}.ts`;
        paths.push({ kind: "file", path: `${dir}/${name}`, name });
      }
    }
  }
  paths.push({ kind: "directory", path: "packages", name: "packages" });
  paths.push({
    kind: "file",
    path: "packages/app/src/index.ts",
    name: "index.ts",
  });
  return paths;
}

describe("finalizeListedPaths on large listings", () => {
  const listing = createLargeListing();

  it.each([
    "p",
    "index.ts",
    "file-24",
    "packages/",
    "packages/app",
    "repo-15/pkg-49/",
    "pkg-3/src/index",
  ])("ranks %j the same as a single pass over every path", async (query) => {
    const result = await finalizeListedPaths({
      paths: listing,
      query,
      includeFiles: true,
      includeDirectories: true,
      limit: 20,
      signal,
    });

    const expected = fuzzyMatchPaths({
      items: listing,
      query,
      getPath: (pathEntry) => pathEntry.path,
      limit: 21,
    });
    expect(
      result.paths.map((pathEntry) => [
        pathEntry.path,
        pathEntry.score,
        pathEntry.positions,
      ]),
    ).toEqual(
      expected
        .slice(0, 20)
        .map((match) => [match.item.path, match.score, match.positions]),
    );
    expect(result.truncated).toBe(expected.length > 20);
  });

  it("lets timers run while concurrent searches rank", async () => {
    let timerRanBeforeSearchesFinished = false;
    let searchesFinished = false;
    const timer = setTimeout(() => {
      timerRanBeforeSearchesFinished = !searchesFinished;
    }, 0);

    await Promise.all(
      ["p", "packages/", "index.ts"].map((query) =>
        finalizeListedPaths({
          paths: listing,
          query,
          includeFiles: true,
          includeDirectories: true,
          limit: 20,
          signal,
        }),
      ),
    );
    searchesFinished = true;
    clearTimeout(timer);

    expect(timerRanBeforeSearchesFinished).toBe(true);
  });

  it("stops a search cancelled while it ranks", async () => {
    const abortController = new AbortController();
    const search = finalizeListedPaths({
      paths: listing,
      query: "packages/",
      includeFiles: true,
      includeDirectories: true,
      limit: 20,
      signal: abortController.signal,
    });
    setImmediate(() => abortController.abort());

    await expect(search).rejects.toMatchObject({ code: "cancelled" });
  });

  it("skips a queued search cancelled before its turn", async () => {
    const queuedAbortController = new AbortController();
    const running = finalizeListedPaths({
      paths: listing,
      query: "p",
      includeFiles: true,
      includeDirectories: true,
      limit: 20,
      signal,
    });
    const queued = finalizeListedPaths({
      paths: listing,
      query: "index.ts",
      includeFiles: true,
      includeDirectories: true,
      limit: 20,
      signal: queuedAbortController.signal,
    });
    queuedAbortController.abort();

    await expect(queued).rejects.toMatchObject({ code: "cancelled" });
    expect((await running).paths).toHaveLength(20);
  });

  it("rejects a search that was cancelled before it started", async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      finalizeListedPaths({
        paths: [{ kind: "file", path: "src/a.ts", name: "a.ts" }],
        query: "a",
        includeFiles: true,
        includeDirectories: false,
        limit: 5,
        signal: abortController.signal,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("normalizeListedPath", () => {
  it("normalizes Windows separators before returning paths", () => {
    expect(normalizeListedPath("src\\components\\Button.tsx")).toBe(
      "src/components/Button.tsx",
    );
  });
});
