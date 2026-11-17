#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_SEGMENTS = new Set([
  "test",
  "tests",
  "testing",
  "__tests__",
  "fixtures",
  "test-helpers",
]);
const TEST_BASENAME_RE =
  /\.(?:test|spec|e2e)\.[cm]?[jt]sx?$|test-support|test-helpers|test-fixture|fixture|global-setup/u;
const SOURCE_RE = /\.[cm]?[jt]sx?$/u;
const PID_NAME_RE =
  /(?:^|[^A-Za-z0-9_$.])(?:pids?|[A-Za-z0-9_$]*Pids?)\b(?![.-])|\.pid\b(?![.\-"'`])/u;

const RULES = [
  {
    id: "signal-zero-probe",
    message:
      "Signal 0 asks whether some process holds this PID, not whether the test's process is alive; PIDs are reused (Windows reuses them quickly). Track the ChildProcess with trackChildProcesses() from @bb/test-helpers, or hold a pipe the process inherits and wait for it to close.",
    find(source) {
      return matchAll(
        source,
        /\bkill\s*\(\s*[^,;()]+(?:\([^()]*\))?\s*,\s*0\s*,?\s*\)/gu,
      );
    },
  },
  {
    id: "pid-liveness-helper",
    message:
      "A liveness helper given a PID answers for whichever process holds that PID now. Observe the owned ChildProcess (trackChildProcesses() from @bb/test-helpers), or a lifeline the process holds (createProcessLifeline()).",
    find(source) {
      const calls = matchAll(
        source,
        /\b[A-Za-z0-9_$]*(?:[Aa]live|[Rr]unning)\s*\(\s*([^;()]*(?:\([^()]*\))?[^;()]*)\)/gu,
      ).filter((match) => PID_NAME_RE.test(match.groups[0]));
      const callbacks = matchAll(
        source,
        /\.(?:some|every|filter|find|findIndex)\(\s*[A-Za-z0-9_$]*(?:[Aa]live|[Rr]unning)\s*\)/gu,
      );
      return [...calls, ...callbacks];
    },
  },
  {
    id: "pid-identity-assertion",
    message:
      "A restarted process can receive the PID of the one it replaced. Compare an identity the process reports itself (for example a boot id), or the ChildProcess objects from trackChildProcesses().",
    find(source) {
      const re =
        /expect\(\s*([^;]*?)\)\s*\.not\s*\.to(?:Be|Equal|StrictEqual)\(\s*([^;]*?)\)/gu;
      return matchAll(source, re).filter(
        (match) =>
          PID_NAME_RE.test(match.groups[0]) ||
          PID_NAME_RE.test(match.groups[1]),
      );
    },
  },
];

function matchAll(source, re) {
  return [...source.matchAll(re)].map((match) => ({
    index: match.index,
    text: match[0],
    groups: match.slice(1),
  }));
}

export function isTestSource(path) {
  if (!SOURCE_RE.test(path)) return false;
  const segments = path.split("/");
  const basename = segments.at(-1);
  if (segments.includes("node_modules")) return false;
  return (
    segments.slice(0, -1).some((segment) => TEST_SEGMENTS.has(segment)) ||
    TEST_BASENAME_RE.test(basename)
  );
}

export function findProcessIdentityChecks(source) {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") lineStarts.push(index + 1);
  }
  const lineOf = (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  return RULES.flatMap((rule) =>
    rule.find(source).map((match) => ({
      rule: rule.id,
      message: rule.message,
      line: lineOf(match.index),
      text: match.text.replace(/\s+/gu, " "),
    })),
  ).sort((a, b) => a.line - b.line);
}

export function scanFiles(root, paths) {
  return paths
    .filter(isTestSource)
    .flatMap((path) =>
      findProcessIdentityChecks(readFileSync(join(root, path), "utf8")).map(
        (finding) => ({ path, ...finding }),
      ),
    );
}

function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const findings = scanFiles(root, trackedFiles(root));
  if (findings.length === 0) return;
  for (const finding of findings) {
    console.error(
      `${finding.path}:${finding.line}: [${finding.rule}] ${finding.text}`,
    );
  }
  const messages = new Map(
    findings.map((finding) => [finding.rule, finding.message]),
  );
  console.error("");
  for (const [rule, message] of messages) console.error(`${rule}: ${message}`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
