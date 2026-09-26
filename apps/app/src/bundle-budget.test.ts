import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  computeBundleStats,
  type BundleChunk,
  type BundleStats,
  type BundleStatsChunkInput,
} from "../vite-bundle-stats";

const execFileAsync = promisify(execFile);
const checkScriptPath = resolve(
  import.meta.dirname,
  "../scripts/check-bundle-budget.mjs",
);

function chunk(
  fileName: string,
  overrides: Partial<BundleStatsChunkInput> = {},
): BundleStatsChunkInput {
  return {
    fileName,
    isEntry: false,
    facadeModuleId: null,
    imports: [],
    moduleIds: [],
    code: "x".repeat(2048),
    ...overrides,
  };
}

const chunks: BundleStatsChunkInput[] = [
  chunk("assets/index.js", {
    isEntry: true,
    imports: ["assets/boot-shared.js"],
  }),
  chunk("assets/boot-shared.js", {
    moduleIds: ["/repo/node_modules/react/index.js"],
  }),
  chunk("assets/SplitWorkspaceRoute.js", {
    facadeModuleId: "/repo/apps/app/src/views/SplitWorkspaceRoute.tsx",
    imports: ["assets/boot-shared.js", "assets/route-only.js"],
  }),
  chunk("assets/route-only.js", {
    moduleIds: [
      "/repo/node_modules/.pnpm/@pierre+diffs@1/node_modules/@pierre/diffs/dist/index.js",
      "/repo/apps/app/src/lib/x.ts",
    ],
  }),
  chunk("assets/only-behind-dynamic-import.js", {
    moduleIds: ["/repo/node_modules/katex/dist/katex.js"],
  }),
];

describe("computeBundleStats", () => {
  it("records a route closure without the boot chunks or lazy-only chunks", () => {
    const warn = vi.fn();
    const stats = computeBundleStats(
      chunks,
      { SplitWorkspaceRoute: "/src/views/SplitWorkspaceRoute.tsx" },
      warn,
    );
    if (stats === null) throw new Error("expected stats");

    expect(stats.bootChunks.map((c) => c.fileName)).toEqual([
      "assets/boot-shared.js",
      "assets/index.js",
    ]);
    const route = stats.routeClosures.SplitWorkspaceRoute;
    if (route === undefined) throw new Error("expected the route closure");
    expect(route.entry).toBe("assets/SplitWorkspaceRoute.js");
    expect(route.chunks.map((c) => c.fileName)).toEqual([
      "assets/SplitWorkspaceRoute.js",
      "assets/route-only.js",
    ]);
    expect(route.chunks[1]?.packages).toEqual(["@pierre/diffs"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns instead of throwing when a measured route has no chunk", () => {
    const warn = vi.fn();
    const stats = computeBundleStats(chunks, { Missing: "/nope.tsx" }, warn);
    expect(stats?.routeClosures).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("measures grouped routes whose entry no longer has a facade", () => {
    const grouped = chunks.map((entry) =>
      entry.facadeModuleId?.endsWith("/SplitWorkspaceRoute.tsx")
        ? {
            ...entry,
            facadeModuleId: null,
            moduleIds: [entry.facadeModuleId],
          }
        : entry,
    );
    const stats = computeBundleStats(
      grouped,
      { SplitWorkspaceRoute: "/src/views/SplitWorkspaceRoute.tsx" },
      vi.fn(),
    );
    expect(
      stats?.routeClosures.SplitWorkspaceRoute?.chunks.map((c) => c.fileName),
    ).toEqual(["assets/SplitWorkspaceRoute.js", "assets/route-only.js"]);
  });

  it.each(["assets/index.js", "assets/boot-shared.js"])(
    "rejects a route absorbed into the boot chunk %s",
    async (bootChunk) => {
      const eager = chunks
        .filter((entry) => entry.fileName !== "assets/SplitWorkspaceRoute.js")
        .map((entry) =>
          entry.fileName === bootChunk
            ? {
                ...entry,
                moduleIds: [
                  ...entry.moduleIds,
                  "/repo/apps/app/src/views/SplitWorkspaceRoute.tsx",
                ],
              }
            : entry,
        );
      const warn = vi.fn();
      const stats = computeBundleStats(
        eager,
        { SplitWorkspaceRoute: "/src/views/SplitWorkspaceRoute.tsx" },
        warn,
      );
      expect(stats?.routeClosures).toEqual({});
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("boot payload"),
      );

      const fixture = await writeFixture(passingBudget);
      await writeFile(
        resolve(fixture.budgetDir, "bundle-stats.json"),
        JSON.stringify(stats),
      );
      const result = await runCheck(fixture);
      expect(result.code).toBe(1);
      expect(result.output).toContain(
        'has no "SplitWorkspaceRoute" route closure',
      );
    },
  );
});

interface Fixture {
  distDir: string;
  budgetDir: string;
}

async function writeFixture(
  budget: unknown,
  stats: BundleStats | null = computeBundleStats(
    chunks,
    { SplitWorkspaceRoute: "/src/views/SplitWorkspaceRoute.tsx" },
    () => undefined,
  ),
  brotliFiles: readonly string[] = chunks.map((c) => c.fileName),
): Promise<Fixture> {
  const root = await mkdtemp(resolve(tmpdir(), "bb-bundle-budget-test-"));
  const distDir = resolve(root, "dist");
  await mkdir(resolve(distDir, "assets"), { recursive: true });
  for (const fileName of brotliFiles) {
    await writeFile(resolve(distDir, `${fileName}.br`), "b".repeat(100));
  }
  await writeFile(resolve(root, "bundle-stats.json"), JSON.stringify(stats));
  await writeFile(resolve(root, "bundle-budget.json"), JSON.stringify(budget));
  return { distDir, budgetDir: root };
}

async function runCheck(fixture: Fixture) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      checkScriptPath,
      fixture.distDir,
      fixture.budgetDir,
    ]);
    return { code: 0, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

const passingBudget = {
  maxBootBytes: 10_000,
  maxBootBrotliBytes: 1_000,
  forbiddenBootPackages: ["@pierre/diffs", "katex"],
  routeClosures: {
    SplitWorkspaceRoute: {
      maxBytes: 10_000,
      maxBrotliBytes: 1_000,
      forbiddenPackages: ["katex"],
    },
  },
};

describe("check-bundle-budget", () => {
  it("passes when the boot payload and the route closure are within budget", async () => {
    const result = await runCheck(await writeFixture(passingBudget));
    expect(result.output).toContain("Bundle budget OK");
    expect(result.code).toBe(0);
  });

  it("fails when a forbidden package reaches the route closure", async () => {
    const result = await runCheck(
      await writeFixture({
        ...passingBudget,
        routeClosures: {
          SplitWorkspaceRoute: {
            ...passingBudget.routeClosures.SplitWorkspaceRoute,
            forbiddenPackages: ["@pierre/diffs"],
          },
        },
      }),
    );
    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "@pierre/diffs is in the SplitWorkspaceRoute closure (assets/route-only.js)",
    );
  });

  it("fails when the route closure grows past its ratchet", async () => {
    const result = await runCheck(
      await writeFixture({
        ...passingBudget,
        routeClosures: {
          SplitWorkspaceRoute: {
            ...passingBudget.routeClosures.SplitWorkspaceRoute,
            maxBytes: 3_000,
          },
        },
      }),
    );
    expect(result.code).toBe(1);
    expect(result.output).toContain("SplitWorkspaceRoute closure is 4.0 KB");
    expect(result.output).toContain("over the 2.9 KB raw budget");
  });
});

const KATEX_GATE = "src/components/ui/markdown-katex.ts";

function statsChunk(
  fileName: string,
  spec: Partial<Pick<BundleChunk, "packages" | "imports" | "facade">> = {},
): BundleChunk {
  return {
    fileName,
    bytes: 512,
    packages: spec.packages ?? [],
    imports: spec.imports ?? [],
    facade: spec.facade ?? null,
  };
}

function writeOnDemandFixture({
  markdownPreviewImports,
  katexGate = KATEX_GATE,
}: {
  markdownPreviewImports: string[];
  katexGate?: string | null;
}): Promise<Fixture> {
  const index = statsChunk("index.js", { facade: "src/main.tsx" });
  const stats: BundleStats = {
    entry: index.fileName,
    bootChunks: [index],
    chunks: [
      index,
      statsChunk("route.js", {
        facade: "src/views/Route.tsx",
        imports: ["markdown-preview.js"],
      }),
      statsChunk("markdown-preview.js", {
        packages: ["react-markdown", "remark-math"],
        imports: markdownPreviewImports,
      }),
      statsChunk("markdown-katex.js", {
        facade: katexGate,
        packages: ["rehype-katex"],
        imports: ["katex.js"],
      }),
      statsChunk("katex.js", { packages: ["katex"] }),
    ],
    routeClosures: {},
  };
  return writeFixture(
    {
      maxBootBytes: 10_000,
      maxBootBrotliBytes: 10_000,
      forbiddenBootPackages: ["katex", "rehype-katex"],
      onDemandPackages: { katex: KATEX_GATE, "rehype-katex": KATEX_GATE },
    },
    stats,
    [],
  );
}

describe("check-bundle-budget on-demand packages", () => {
  it("passes when KaTeX is reachable only through the markdown-katex gate", async () => {
    const result = await runCheck(
      await writeOnDemandFixture({ markdownPreviewImports: [] }),
    );

    expect(result.output).toContain("Bundle budget OK");
    expect(result.code).toBe(0);
  });

  it("fails when markdown-preview statically imports the katex chunk", async () => {
    const result = await runCheck(
      await writeOnDemandFixture({ markdownPreviewImports: ["katex.js"] }),
    );

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "katex is in the static import closure of route.js, markdown-preview.js",
    );
    expect(result.output).not.toContain("rehype-katex is in the static");
  });

  it("fails when the gate module disappears from the build", async () => {
    const result = await runCheck(
      await writeOnDemandFixture({
        markdownPreviewImports: [],
        katexGate: null,
      }),
    );

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      `katex has no gate chunk for ${KATEX_GATE}`,
    );
  });
});
