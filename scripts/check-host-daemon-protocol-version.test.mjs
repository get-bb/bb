import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  evaluateProtocolChange,
  normalizeTypeScript,
  readProtocolVersion,
  run,
} from "./check-host-daemon-protocol-version.mjs";

const contractDir = "packages/host-daemon-contract/src";
const protocol = (version) =>
  `export const HOST_DAEMON_PROTOCOL_VERSION = ${version} as const;\n`;
const changedFile = (before, after) => [
  { path: `${contractDir}/commands.ts`, before, after },
];

function git(rootDir, ...args) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepository(t) {
  const rootDir = mkdtempSync(path.join(tmpdir(), "bb-protocol-guard-"));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));

  mkdirSync(path.join(rootDir, contractDir), { recursive: true });
  writeFileSync(path.join(rootDir, contractDir, "protocol.ts"), protocol(143));
  writeFileSync(
    path.join(rootDir, contractDir, "commands.ts"),
    "export interface Command {}\n",
  );

  git(rootDir, "init", "--quiet");
  git(rootDir, "config", "user.email", "tests@getbb.app");
  git(rootDir, "config", "user.name", "BB Tests");
  git(rootDir, "add", ".");
  git(rootDir, "commit", "--quiet", "-m", "base");

  return { rootDir, baseRef: git(rootDir, "rev-parse", "HEAD") };
}

function captureRun(options) {
  const stdout = [];
  const stderr = [];
  const exitCode = run({
    ...options,
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  });
  return { exitCode, stdout, stderr };
}

test("reads only the exported protocol version declaration", () => {
  assert.equal(
    readProtocolVersion(
      `// HOST_DAEMON_PROTOCOL_VERSION = 999 as const\n${protocol(143)}`,
    ),
    143,
  );
  assert.throws(
    () => readProtocolVersion("export const HOST_DAEMON_PROTOCOL_VERSION = 1;"),
    /Could not read/u,
  );
});

test("normalizes formatting and comments without hiding code", () => {
  assert.equal(
    normalizeTypeScript("// old\nexport interface Value { id: string }"),
    normalizeTypeScript("/* new */ export interface Value {\n id: string;\n}"),
  );
  assert.notEqual(
    normalizeTypeScript("/* explanation */ export interface Value {}"),
    normalizeTypeScript(
      "/* explanation */ export interface Value { id: string }",
    ),
  );
  assert.notEqual(
    normalizeTypeScript('export const value = "a  b";'),
    normalizeTypeScript('export const value = "a b";'),
  );
  assert.throws(
    () => normalizeTypeScript("export const value = {"),
    /Could not parse/u,
  );
});

test("passes documentation-only contract changes without a bump", () => {
  assert.deepEqual(
    evaluateProtocolChange({
      files: changedFile("// Old explanation\n", "// New explanation\n"),
      baseSource: protocol(143),
      headSource: protocol(143),
    }),
    { ok: true, reason: "no-contract-change" },
  );
});

test("requires a strictly higher version for contract code changes", () => {
  assert.deepEqual(
    evaluateProtocolChange({
      files: changedFile(
        "export interface Value {}",
        "export interface Value { id: string }",
      ),
      baseSource: protocol(143),
      headSource: protocol(143),
    }),
    {
      ok: false,
      reason: "version-not-increased",
      baseVersion: 143,
      headVersion: 143,
    },
  );

  assert.deepEqual(
    evaluateProtocolChange({
      files: changedFile(
        "export interface Value {}",
        "export interface Value { id: string }",
      ),
      baseSource: protocol(143),
      headSource: protocol(144),
    }),
    {
      ok: true,
      reason: "version-increased",
      baseVersion: 143,
      headVersion: 144,
    },
  );
});

test("checks the real git repository path and exit behavior", (t) => {
  const { rootDir, baseRef } = createRepository(t);
  writeFileSync(
    path.join(rootDir, contractDir, "commands.ts"),
    "export interface Command { id: string }\n",
  );

  const rejected = captureRun({ args: [baseRef], rootDir });
  assert.equal(rejected.exitCode, 1);
  assert.match(rejected.stderr.join("\n"), /without increasing/u);

  writeFileSync(path.join(rootDir, contractDir, "protocol.ts"), protocol(144));
  const accepted = captureRun({ args: [baseRef], rootDir });
  assert.equal(accepted.exitCode, 0);
  assert.match(accepted.stdout.join("\n"), /143 -> 144/u);
});

test("detects contract files renamed outside the guarded directory", (t) => {
  const { rootDir, baseRef } = createRepository(t);
  const movedDir = path.join(rootDir, "moved");
  mkdirSync(movedDir);
  renameSync(
    path.join(rootDir, contractDir, "commands.ts"),
    path.join(movedDir, "commands.ts"),
  );

  const result = captureRun({ args: [baseRef], rootDir });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr.join("\n"), /without increasing/u);
});

test("detects untracked contract source files", (t) => {
  const { rootDir, baseRef } = createRepository(t);
  writeFileSync(
    path.join(rootDir, contractDir, "new-command.ts"),
    "export interface NewCommand {}\n",
  );

  const result = captureRun({ args: [baseRef], rootDir });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr.join("\n"), /without increasing/u);
});

test("reports unavailable or missing comparison bases clearly", (t) => {
  const { rootDir } = createRepository(t);

  const unavailable = captureRun({ args: ["0".repeat(40)], rootDir });
  assert.equal(unavailable.exitCode, 2);
  assert.match(unavailable.stderr.join("\n"), /all-zero object ID/u);

  const missing = captureRun({ args: [], rootDir });
  assert.equal(missing.exitCode, 2);
  assert.match(missing.stderr.join("\n"), /Usage:/u);
});
