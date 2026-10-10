import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "ci-selection-"));
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }));
  const put = (path, contents) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), contents);
  };
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  put(
    "package.json",
    JSON.stringify({
      name: "bb",
      private: true,
      packageManager: "pnpm@9.15.0",
    }),
  );
  put("pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n");
  put(
    "pnpm-lock.yaml",
    "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  apps/app:\n    dependencies:\n      '@bb/config':\n        specifier: workspace:*\n        version: link:../../packages/config\n  packages/config: {}\n  packages/text-utils: {}\n  apps/mobile: {}\n",
  );
  put(
    "turbo.json",
    JSON.stringify({
      tasks: {
        test: { dependsOn: ["topo"] },
        topo: { dependsOn: ["^topo"] },
        build: { dependsOn: ["^build"] },
        lint: {},
        typecheck: { dependsOn: ["topo"] },
      },
    }),
  );
  for (const [path, name, dependencies] of [
    ["apps/app", "@bb/app", { "@bb/config": "workspace:*" }],
    ["packages/config", "@bb/config", {}],
    ["packages/text-utils", "@bb/text-utils", {}],
    ["apps/mobile", "@bb/mobile", {}],
  ]) {
    put(
      `${path}/package.json`,
      JSON.stringify({
        name,
        version: "1.0.0",
        scripts: {
          test: "echo test",
          build: "echo build",
          lint: "echo lint",
          typecheck: "echo typecheck",
        },
        dependencies,
      }),
    );
    put(`${path}/src/index.ts`, "export const value = 1;\n");
  }
  put(
    "scripts/ci-test-shards.json",
    readFileSync(join(root, "scripts/ci-test-shards.json"), "utf8"),
  );
  git("init", "--initial-branch=main");
  git("config", "user.email", "ci@example.test");
  git("config", "user.name", "CI Test");
  git("config", "commit.gpgsign", "false");
  git("add", ".");
  git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  return {
    cwd,
    put,
    git,
    base,
    plan(path) {
      put(path, "export const value = 2;\n");
      git("add", ".");
      git("commit", "-m", "change");
      const affected = execFileSync(
        process.execPath,
        [
          join(root, "node_modules/turbo/bin/turbo"),
          "query",
          "affected",
          "--base",
          base,
          "--head",
          "HEAD",
        ],
        {
          cwd,
          encoding: "utf8",
          timeout: 30_000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      put("affected.json", affected);
      return JSON.parse(
        execFileSync(
          process.execPath,
          [
            join(root, "scripts/plan-ci.mjs"),
            "--base",
            base,
            "--affected",
            "affected.json",
          ],
          {
            cwd,
            encoding: "utf8",
            timeout: 30_000,
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      );
    },
  };
}

it("selects app checks without provisioning unrelated Windows or package smoke jobs", () => {
  const plan = fixture().plan("apps/app/src/index.ts");
  expect(plan.tests.include.map((entry) => entry.shard)).toEqual([
    "app-1",
    "app-2",
    "app-3",
    "app-4",
    "app-5",
    "app-6",
    "app-7",
    "app-8",
  ]);
  expect(plan["windows-tests"].include).toEqual([]);
  expect(plan.tests.include.every((entry) => entry.mobile === false)).toBe(
    true,
  );
  expect(plan.packaging).toBe(false);
  expect(plan.foundation).toBe(false);
  expect(plan.forks).toBe(false);
  expect(plan.staticFilters).toContain("--filter=@bb/app");
  expect(plan.staticFilters).not.toContain("@bb/text-utils");
}, 30_000);

it("omits mobile installs only when the selected tests do not include mobile", () => {
  const selected = fixture().plan("packages/text-utils/src/index.ts");
  for (const matrix of ["tests", "windows-tests"]) {
    expect(selected[matrix].include).toEqual([
      expect.objectContaining({ shard: "packages-other", mobile: false }),
    ]);
  }
  const mobile = fixture().plan("apps/mobile/src/index.ts");
  for (const matrix of ["tests", "windows-tests"]) {
    expect(mobile[matrix].include).toEqual([
      expect.objectContaining({ shard: "packages-other", mobile: true }),
    ]);
  }
  const full = JSON.parse(
    execFileSync(
      process.execPath,
      [join(root, "scripts/plan-ci.mjs"), "--full"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
      },
    ),
  );
  for (const matrix of ["tests", "windows-tests"]) {
    expect(
      full[matrix].include.find((entry) => entry.shard === "packages-other")
        .mobile,
    ).toBe(true);
  }
});

it("keeps dependent app tests and Windows foundation checks for shared configuration changes", () => {
  const plan = fixture().plan("packages/config/src/index.ts");
  expect(
    plan.tests.include.some((entry) =>
      entry.filter.includes("--filter=@bb/app"),
    ),
  ).toBe(true);
  expect(
    plan["windows-tests"].include.some((entry) =>
      entry.filter.includes("--filter=@bb/app"),
    ),
  ).toBe(true);
  expect(plan.foundation).toBe(true);
  expect(plan.staticFilters).toContain("--filter=@bb/config");
  expect(plan.staticFilters).toContain("--filter=@bb/app");
  expect(plan.staticFilters).not.toContain("@bb/text-utils");
});

it("retains Windows and package smokes for frontend build configuration", () => {
  const plan = fixture().plan("apps/app/vite.config.ts");
  expect(plan.packaging).toBe(true);
  expect(
    plan["windows-tests"].include.some((entry) => entry.shard === "app-4"),
  ).toBe(true);
});

it("falls back to full coverage for unknown paths", () => {
  const plan = fixture().plan("new-tooling/settings.json");
  expect(plan.packaging).toBe(true);
  expect(plan.providers).toBe(true);
  expect(
    plan["windows-tests"].include.some((entry) => entry.shard === "server-3"),
  ).toBe(true);
});

it("skips the matrix for CI documentation", () => {
  const plan = fixture().plan("docs/ci-performance.md");
  expect(plan.tests.include).toEqual([]);
  expect(plan["windows-tests"].include).toEqual([]);
  expect(plan.buildNeeded).toBe(false);
  expect(plan.staticNeeded).toBe(false);
  expect(plan.packaging).toBe(false);
});

it.each([
  "docs/provider-plugin-api.md",
  "docs/api_to_audit.md",
  "docs/lifecycle-diagrams.md",
])("keeps executable documentation contracts for %s", (path) => {
  const plan = fixture().plan(path);
  expect(plan.tests.include.length).toBeGreaterThan(0);
  expect(plan.buildNeeded).toBe(true);
});

it.each(["missing base", "malformed query"])(
  "fails open to full coverage for %s",
  (failure) => {
    const f = fixture();
    f.plan("apps/app/src/index.ts");
    if (failure === "malformed query")
      f.put("affected.json", '{"data":{"affectedTasks":{"items":[{}]}}}');
    const output = execFileSync(
      process.execPath,
      [
        join(root, "scripts/plan-ci.mjs"),
        "--base",
        failure === "missing base" ? "missing-ref" : f.base,
        "--affected",
        "affected.json",
      ],
      {
        cwd: f.cwd,
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const plan = JSON.parse(output);
    expect(plan.reason).toBe("Full cross-platform coverage");
    expect(plan.foundation).toBe(true);
    expect(plan.packaging).toBe(true);
  },
);

it.each([
  ["pnpm-lock.yaml", true],
  ["pnpm-workspace.yaml", true],
  ["package.json", true],
  ["apps/app/package.json", true],
  [".npmrc", true],
  [".pnpmfile.cjs", true],
  ["patches/sonner.patch", true],
  ["apps/app/src/index.ts", false],
  ["docs/ci-performance.md", false],
])("requires dependency validation for %s: %s", (path, required) => {
  const f = fixture();
  f.put(path, "changed\n");
  f.git("add", ".");
  f.git("commit", "-m", "change");
  const output = execFileSync(
    process.execPath,
    [join(root, "scripts/ci-dependencies-changed.mjs"), f.base],
    { cwd: f.cwd, encoding: "utf8", timeout: 30_000 },
  );
  expect(output.trim()).toBe(String(required));
});

it.each(["", "missing-ref"])(
  "requires dependency validation without usable history (%s)",
  (base) => {
    const f = fixture();
    expect(
      execFileSync(
        process.execPath,
        [join(root, "scripts/ci-dependencies-changed.mjs"), base],
        { cwd: f.cwd, encoding: "utf8", timeout: 30_000 },
      ).trim(),
    ).toBe("true");
  },
);

it("compares a refreshed PR merge against its actual base without treating unrelated main changes as PR work", () => {
  const f = fixture();
  f.plan("apps/app/src/index.ts");
  const head = f.git("rev-parse", "HEAD");
  f.git("branch", "feature");
  f.git("checkout", "-b", "updated-main", f.base);
  f.put("unrelated-root-config.json", "{}\n");
  f.git("add", ".");
  f.git("commit", "-m", "advance main after the PR event");
  const currentBase = f.git("rev-parse", "HEAD");
  f.git("merge", "--no-ff", "feature", "-m", "refreshed merge");
  const resolveBase = (eventBase, prHead) =>
    execFileSync(
      process.execPath,
      [join(root, "scripts/ci-comparison-base.mjs"), eventBase, prHead],
      { cwd: f.cwd, encoding: "utf8", timeout: 30_000 },
    ).trim();
  expect(resolveBase(f.base, head)).toBe(currentBase);
  expect(resolveBase(f.base, "0".repeat(40))).toBe(f.base);
  expect(resolveBase(f.base, "")).toBe(f.base);
  const plan = (base) => {
    f.put(
      "affected.json",
      execFileSync(
        process.execPath,
        [
          join(root, "node_modules/turbo/bin/turbo"),
          "query",
          "affected",
          "--base",
          base,
          "--head",
          "HEAD",
        ],
        { cwd: f.cwd, encoding: "utf8", timeout: 30_000 },
      ),
    );
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          join(root, "scripts/plan-ci.mjs"),
          "--base",
          base,
          "--affected",
          "affected.json",
        ],
        { cwd: f.cwd, encoding: "utf8", timeout: 30_000 },
      ),
    );
  };
  expect(plan(f.base).packaging).toBe(true);
  const selected = plan(resolveBase(f.base, head));
  expect(selected.packaging).toBe(false);
  expect(selected["windows-tests"].include).toEqual([]);
  expect(
    selected.tests.include.every(
      (entry) => entry.filter === "--filter=@bb/app",
    ),
  ).toBe(true);
});
