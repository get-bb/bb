#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ALLOWLIST_PATH = "scripts/test-shuffle-opt-outs.json";

const SOURCE_RE = /\.[cm]?[jt]sx?$/u;
const OPT_OUT_PATTERNS = [
  /(?:^|[^A-Za-z0-9_$])["']?shuffle["']?\s*:\s*false\b/gu,
  /\bsequence\.shuffle\s*=\s*false\b/gu,
  /--sequence\.shuffle(?:=|\s+)false\b/gu,
  /--no-sequence\.shuffle\b/gu,
];

export function isScannedPath(path) {
  if (path.split("/").includes("node_modules")) return false;
  return (
    SOURCE_RE.test(path) ||
    path.endsWith("/package.json") ||
    path === "package.json"
  );
}

export function findShuffleOptOuts(source) {
  const lines = [];
  for (const pattern of OPT_OUT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      lines.push(source.slice(0, match.index).split("\n").length);
    }
  }
  return [...new Set(lines)].sort((a, b) => a - b);
}

export function parseAllowlist(text) {
  const value = JSON.parse(text);
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray(value.optOuts)
  ) {
    throw new Error(
      `${ALLOWLIST_PATH} must be { "optOuts": [{ "path", "reason" }] }`,
    );
  }
  return value.optOuts.map((entry, index) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.path !== "string" ||
      typeof entry.reason !== "string"
    ) {
      throw new Error(
        `${ALLOWLIST_PATH} entry ${index} needs a string path and reason`,
      );
    }
    return { path: entry.path, reason: entry.reason };
  });
}

export function checkOptOuts(findings, allowlist) {
  const errors = [];
  const allowed = new Map();
  for (const entry of allowlist) {
    if (entry.reason.trim().length === 0) {
      errors.push(`${entry.path}: the allowlist entry needs a reason`);
    }
    if (allowed.has(entry.path)) {
      errors.push(`${entry.path}: listed more than once in ${ALLOWLIST_PATH}`);
    }
    allowed.set(entry.path, entry);
  }
  for (const [path, lines] of findings) {
    if (!allowed.has(path)) {
      errors.push(
        `${path}:${lines.join(",")}: disables test shuffling. Make the tests order-independent, or add { "path", "reason" } to ${ALLOWLIST_PATH} saying why this suite must run in a fixed order.`,
      );
    }
  }
  for (const path of allowed.keys()) {
    if (!findings.has(path)) {
      errors.push(
        `${path}: no longer disables shuffling; remove it from ${ALLOWLIST_PATH}`,
      );
    }
  }
  return errors;
}

export function scanFiles(root, paths) {
  const findings = new Map();
  for (const path of paths) {
    if (!isScannedPath(path) || path === ALLOWLIST_PATH) continue;
    if (path === "scripts/check-test-shuffle-opt-outs.mjs") continue;
    const lines = findShuffleOptOuts(readFileSync(join(root, path), "utf8"));
    if (lines.length > 0) findings.set(path, lines);
  }
  return findings;
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const paths = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
  const allowlist = parseAllowlist(
    readFileSync(join(root, ALLOWLIST_PATH), "utf8"),
  );
  const errors = checkOptOuts(scanFiles(root, paths), allowlist);
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
