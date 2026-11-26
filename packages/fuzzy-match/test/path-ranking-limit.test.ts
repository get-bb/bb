import { beforeEach, describe, expect, it, vi } from "vitest";
import { fuzzyMatchPaths } from "../src/index.js";

const fzfWork = vi.hoisted(() => ({ candidates: 0 }));

vi.mock("fzf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fzf")>();
  return {
    ...actual,
    Fzf: new Proxy(actual.Fzf, {
      construct(target, args, newTarget) {
        const [list] = args as [readonly unknown[]];
        fzfWork.candidates += list.length;
        return Reflect.construct(target, args, newTarget) as object;
      },
    }),
  };
});

const DIRECTORY_NAMES = [
  "src",
  "test",
  "lib",
  "components",
  "hooks",
  "server",
  "search",
  "settings",
  "session",
  "routes",
  "utils",
  "generated",
];

const FILE_NAMES = [
  "index",
  "search-results",
  "session-store",
  "settings-panel",
  "server",
  "router",
  "use-search",
  "thread-list",
  "prompt-box",
  "selection",
  "file-tree",
  "status",
];

const WORKSPACE_PATH_COUNT = 20_000;

function createWorkspacePaths(): string[] {
  return Array.from({ length: WORKSPACE_PATH_COUNT }, (_, index) => {
    const root = index % 5 === 0 ? "apps" : "packages";
    const outer = DIRECTORY_NAMES[index % DIRECTORY_NAMES.length];
    const inner =
      DIRECTORY_NAMES[
        Math.floor(index / DIRECTORY_NAMES.length) % DIRECTORY_NAMES.length
      ];
    const fileName = FILE_NAMES[Math.floor(index / 7) % FILE_NAMES.length];
    return `${root}/pkg-${index % 200}/${outer}/${inner}/${fileName}-${index}.ts`;
  });
}

function createOverlappingTierPaths(): string[] {
  return [
    `${"se/".repeat(3_000)}leaf.ts`,
    `docs/${"se".repeat(30_000)}.md`,
    `${"src/".repeat(2_000)}se.ts`,
    `packages/se/${"z".repeat(60_000)}se`,
    "Packages/Session/Server.ts",
    "packages/pkg-1/src/seéance.ts",
  ];
}

function rankPaths(paths: readonly string[], query: string, limit: number) {
  return fuzzyMatchPaths({
    items: paths,
    query,
    getPath: (path) => path,
    limit,
  });
}

describe("fuzzyMatchPaths limit", () => {
  beforeEach(() => {
    fzfWork.candidates = 0;
  });

  it.each([
    ["se", 2_000],
    ["src", 2_000],
    ["packages/se", WORKSPACE_PATH_COUNT],
  ])(
    "skips fzf work that cannot reach the top results for %s",
    (query, maxCandidates) => {
      const paths = createWorkspacePaths();

      expect(rankPaths(paths, query, 17)).toHaveLength(17);
      expect(fzfWork.candidates).toBeLessThanOrEqual(maxCandidates);
    },
  );

  it.each([
    "s",
    "se",
    "Se",
    "src",
    "sess",
    "searchresults",
    "settings-panel-1",
    "rt",
    "pkg-1",
    "packages/",
    "packages/se",
    "packages/pkg-1/se",
    "src/",
    "src/se",
    "search/use",
    "apps/pkg-5/",
    "a/b/c/d/e/f/g/h/i",
    "sé",
  ])("returns the leading results of the unlimited ranking for %s", (query) => {
    const paths = [
      ...createOverlappingTierPaths(),
      ...createWorkspacePaths().slice(0, 4_000),
      "packages/pkg-1/src/seéance.ts",
    ];
    const unlimited = rankPaths(paths, query, paths.length + 1);

    for (const limit of [1, 8, 17, 100]) {
      expect(rankPaths(paths, query, limit)).toEqual(unlimited.slice(0, limit));
    }
  });
});
