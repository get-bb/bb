#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const SHUFFLE_SEEDS = [1, 3, 8];

const WORKSPACE_ROOTS = [
  "apps",
  "packages",
  "plugins",
  "tests",
  "examples/plugins",
];
const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

export function isTestFile(path) {
  return TEST_FILE_RE.test(path) && !path.split("/").includes("node_modules");
}

export function listWorkspacePackages(root) {
  return WORKSPACE_ROOTS.flatMap((workspaceRoot) => {
    const directory = join(root, workspaceRoot);
    if (!existsSync(directory)) return [];
    return readdirSync(directory).flatMap((name) => {
      const manifestPath = join(directory, name, "package.json");
      if (!existsSync(manifestPath)) return [];
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const test = manifest.scripts?.test;
      if (typeof manifest.name !== "string" || typeof test !== "string")
        return [];
      if (!/\bvitest run\b/u.test(test)) return [];
      return [{ dir: `${workspaceRoot}/${name}`, name: manifest.name }];
    });
  });
}

export function selectShuffledTests(paths, packages) {
  const byPackage = new Map();
  for (const path of paths) {
    if (!isTestFile(path)) continue;
    const owner = packages
      .filter((entry) => path.startsWith(`${entry.dir}/`))
      .sort((a, b) => b.dir.length - a.dir.length)[0];
    if (owner === undefined) continue;
    const files = byPackage.get(owner.name) ?? [];
    files.push(relative(owner.dir, path));
    byPackage.set(owner.name, files);
  }
  const selected = [...byPackage]
    .map(([name, files]) => ({ package: name, files: files.sort() }))
    .sort((a, b) => a.package.localeCompare(b.package));
  return {
    packages: selected,
    desktop: selected.some((entry) => entry.package === "@bb/desktop"),
    mobile: selected.some((entry) => entry.package === "@bb/mobile"),
    seeds: selected.length === 0 ? [] : SHUFFLE_SEEDS,
  };
}

export function shuffledTestCommand(entry, seed) {
  return [
    "pnpm",
    "exec",
    "turbo",
    "run",
    "test",
    `--filter=${entry.package}`,
    "--output-logs=new-only",
    "--",
    ...entry.files,
    "--sequence.shuffle",
    `--sequence.seed=${seed}`,
    "--passWithNoTests",
  ];
}

function quote(argument) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(argument)
    ? argument
    : `'${argument.replaceAll("'", "'\\''")}'`;
}

function changedPaths(root, base) {
  return execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      "--no-renames",
      "--diff-filter=d",
      "-z",
      base,
      "HEAD",
      "--",
    ],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  )
    .split("\0")
    .filter(Boolean);
}

function run(root, selection, seed) {
  const failures = [];
  for (const entry of selection.packages) {
    const command = shuffledTestCommand(entry, seed);
    const [program, ...args] = command;
    const result = spawnSync(program, args, { cwd: root, stdio: "inherit" });
    if (result.status !== 0) failures.push(command.map(quote).join(" "));
  }
  if (failures.length === 0) return 0;
  const summary = [
    `### Changed tests failed in shuffled order (seed ${seed})`,
    "",
    "Reproduce:",
    "",
    "```bash",
    ...failures,
    "```",
    "",
  ].join("\n");
  console.error(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  return 1;
}

function main() {
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      run: { type: "string" },
      seed: { type: "string" },
    },
  });
  const root = fileURLToPath(new URL("..", import.meta.url));
  if (values.run !== undefined) {
    if (values.seed === undefined || !/^\d+$/u.test(values.seed)) {
      throw new Error("--run needs --seed <integer>");
    }
    process.exitCode = run(root, JSON.parse(values.run), Number(values.seed));
    return;
  }
  if (values.base === undefined)
    throw new Error("Pass --base <sha> or --run <selection>");
  process.stdout.write(
    JSON.stringify(
      selectShuffledTests(
        changedPaths(root, values.base),
        listWorkspacePackages(root),
      ),
    ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
