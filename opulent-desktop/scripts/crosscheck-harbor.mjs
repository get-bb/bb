/**
 * Cross-check: our TypeScript Harbor emitter against Repo2RLEnv's Python writer.
 *
 * Runs both on the same task and compares the parsed `task.toml` trees plus the emitted
 * file set. A structural match is the real contract — TOML key order and float formatting
 * are not, so we compare parsed data rather than bytes.
 *
 * Usage: node scripts/crosscheck-harbor.mjs
 * Requires: python3 with tomli_w, and research/src/OpulentiaAI_Repo2RLEnv present.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { emitHarborTask } from "../packages/harbor/harbor.ts";

const R2RE = "/opulent/workspace/research/src/OpulentiaAI_Repo2RLEnv/src";

const task = {
  name: "opulent__crosscheck",
  org: "opulent",
  description: "Cross-check task",
  instruction: "Fix the thing.\n",
  oracleDiff: "--- a/x\n+++ b/x\n@@\n-a\n+b\n",
  keywords: ["python", "bugfix"],
  environmentDockerfile: "FROM python:3.12-slim-bookworm\nRUN pip install pytest\n",
  testScript: "#!/bin/bash\npytest -q\n",
  auxFiles: { "tests/f2p.json": '["tests/test_x.py::test_y"]' },
};

const root = mkdtempSync(join(tmpdir(), "harbor-crosscheck-"));
const tsDir = join(root, "ts");
const pyDir = join(root, "py");

// --- our emitter -------------------------------------------------------------
for (const file of emitHarborTask(task)) {
  const dest = join(tsDir, file.path);
  execFileSync("mkdir", ["-p", join(dest, "..")]);
  writeFileSync(dest, file.content, { mode: file.mode });
}

// --- Repo2RLEnv's emitter ----------------------------------------------------
const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(R2RE)})
from pathlib import Path
from repo2rlenv.emitter.harbor import HarborTask, write_harbor_task

t = HarborTask(
    name=${JSON.stringify(task.name)},
    org=${JSON.stringify(task.org)},
    description=${JSON.stringify(task.description)},
    instruction=${JSON.stringify(task.instruction)},
    oracle_diff=${JSON.stringify(task.oracleDiff)},
    repo2env={},
    keywords=${JSON.stringify(task.keywords)},
    environment_dockerfile=${JSON.stringify(task.environmentDockerfile)},
    test_script=${JSON.stringify(task.testScript)},
    aux_files=${JSON.stringify(task.auxFiles)},
)
write_harbor_task(t, Path(${JSON.stringify(pyDir)}))
`;
execFileSync("mkdir", ["-p", pyDir]);
execFileSync("python3", ["-c", py], { stdio: "inherit" });

// --- compare -----------------------------------------------------------------
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out.sort();
}

const tsFiles = walk(tsDir).map((p) => relative(tsDir, p));
const pyFiles = walk(pyDir).map((p) => relative(pyDir, p));

const problems = [];

const tsSet = new Set(tsFiles);
const pySet = new Set(pyFiles);
for (const f of pySet) if (!tsSet.has(f)) problems.push(`missing from TS output: ${f}`);
for (const f of tsSet) if (!pySet.has(f)) problems.push(`extra in TS output: ${f}`);

// Executable bits on the two scripts Harbor runs.
for (const script of [
  `${task.name}/solution/solve.sh`,
  `${task.name}/tests/test.sh`,
]) {
  const tsMode = statSync(join(tsDir, script)).mode & 0o777;
  const pyMode = statSync(join(pyDir, script)).mode & 0o777;
  if ((tsMode & 0o111) !== (pyMode & 0o111)) {
    problems.push(
      `${script}: exec bits differ (ts ${tsMode.toString(8)}, py ${pyMode.toString(8)})`,
    );
  }
}

// Byte-identical content for everything except task.toml (key order differs).
for (const f of tsFiles) {
  if (f.endsWith("task.toml")) continue;
  if (!pySet.has(f)) continue;
  const a = readFileSync(join(tsDir, f), "utf8");
  const b = readFileSync(join(pyDir, f), "utf8");
  if (a !== b) problems.push(`content differs: ${f}`);
}

// Structural comparison of task.toml.
const cmp = execFileSync(
  "python3",
  [
    "-c",
    `
import json, tomllib
a = tomllib.load(open(${JSON.stringify(join(tsDir, task.name, "task.toml"))}, "rb"))
b = tomllib.load(open(${JSON.stringify(join(pyDir, task.name, "task.toml"))}, "rb"))
print(json.dumps({"ts": a, "py": b}))
`,
  ],
  { encoding: "utf8" },
);
const { ts, py: pyToml } = JSON.parse(cmp);

function compare(path, a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      compare(`${path}.${key}`, a[key], b[key]);
    }
    return;
  }
  problems.push(`task.toml${path}: ts=${JSON.stringify(a)} py=${JSON.stringify(b)}`);
}
compare("", ts, pyToml);

if (problems.length > 0) {
  console.error("CROSS-CHECK FAILED");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log("CROSS-CHECK PASSED");
console.log(`  files: ${tsFiles.length} identical (task.toml compared structurally)`);
console.log(`  content_hash: ${ts.metadata.repo2env.content_hash}`);
console.log(`  reward_kinds: ${JSON.stringify(ts.metadata.repo2env.reward_kinds)}`);
console.log(`  image_ref:    ${ts.metadata.repo2env.reproducibility.image_ref}`);
