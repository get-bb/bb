import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  isTestFile,
  listWorkspacePackages,
  selectShuffledTests,
  SHUFFLE_SEEDS,
  shuffledTestCommand,
} from "../../../scripts/plan-shuffled-tests.mjs";

const packages = [
  { dir: "apps/app", name: "@bb/app" },
  { dir: "apps/desktop", name: "@bb/desktop" },
  { dir: "plugins/connect", name: "bb-plugin-connect" },
  { dir: "packages/db", name: "@bb/db" },
];

describe("selectShuffledTests", () => {
  it("groups changed test files by owning package with paths inside it", () => {
    expect(
      selectShuffledTests(
        [
          "apps/app/src/components/dialogs/ProjectPathDialog.test.tsx",
          "apps/app/src/components/dialogs/ProjectPathDialog.tsx",
          "plugins/connect/app.test.tsx",
          "apps/app/src/lib/a.test.ts",
          "docs/debugging-and-qa.md",
        ],
        packages,
      ),
    ).toEqual({
      packages: [
        {
          package: "@bb/app",
          files: [
            "src/components/dialogs/ProjectPathDialog.test.tsx",
            "src/lib/a.test.ts",
          ],
        },
        { package: "bb-plugin-connect", files: ["app.test.tsx"] },
      ],
      desktop: false,
      mobile: false,
      seeds: SHUFFLE_SEEDS,
    });
  });

  it("selects nothing and no seeds when no test file changed", () => {
    expect(
      selectShuffledTests(["apps/app/src/App.tsx", "README.md"], packages),
    ).toEqual({ packages: [], desktop: false, mobile: false, seeds: [] });
  });

  it("flags packages that need extra runner setup", () => {
    expect(
      selectShuffledTests(["apps/desktop/test/bb-process.test.ts"], packages)
        .desktop,
    ).toBe(true);
  });

  it("ignores test files outside any package with a vitest test script", () => {
    expect(
      selectShuffledTests(["scripts/lib/x.test.mjs"], packages).packages,
    ).toEqual([]);
  });
});

describe("isTestFile", () => {
  it.each([
    ["apps/server/test/perf/request-path-statements.test.ts", true],
    ["packages/scripts/test/start-bb.test.mjs", true],
    ["apps/web/src/a.spec.tsx", true],
    ["plugins/provider-codex/src/bridge/bridge-process.test-support.ts", false],
    ["apps/app/node_modules/x/a.test.js", false],
  ])("%s → %s", (path, expected) => {
    expect(isTestFile(path)).toBe(expected);
  });
});

describe("listWorkspacePackages", () => {
  it("keeps only packages whose test script runs vitest", () => {
    const root = mkdtempSync(join(tmpdir(), "bb-shuffled-plan-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const write = (dir, manifest) => {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest));
    };
    write("apps/app", {
      name: "@bb/app",
      scripts: {
        test: "node check.mjs && vitest run --config vitest.config.ts",
      },
    });
    write("packages/no-tests", { name: "@bb/no-tests", scripts: {} });
    write("plugins/jest", {
      name: "bb-plugin-jest",
      scripts: { test: "jest" },
    });

    expect(listWorkspacePackages(root)).toEqual([
      { dir: "apps/app", name: "@bb/app" },
    ]);
  });
});

describe("shuffledTestCommand", () => {
  it("runs only the selected files through Turbo with the seed", () => {
    expect(
      shuffledTestCommand(
        { package: "@bb/app", files: ["src/a.test.ts", "src/b.test.ts"] },
        3,
      ),
    ).toEqual([
      "pnpm",
      "exec",
      "turbo",
      "run",
      "test",
      "--filter=@bb/app",
      "--output-logs=new-only",
      "--",
      "src/a.test.ts",
      "src/b.test.ts",
      "--sequence.shuffle",
      "--sequence.seed=3",
      "--passWithNoTests",
    ]);
  });
});
