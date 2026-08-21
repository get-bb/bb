#!/usr/bin/env node
/**
 * Provider-literal ratchet (guardrail G1 of the provider-plugin migration).
 *
 * The migration's north star is that core (everything outside the provider
 * plugins) never branches on a specific provider id. Today it does so in many
 * places. This guard freezes that surface as a per-file baseline and lets it
 * move in only one direction: down. A change that adds a provider-id literal
 * to a core file, or introduces a new core file that carries one, fails. A
 * change that removes literals must regenerate the baseline (`--write`) so the
 * win is committed and visible in the diff. When the baseline reaches zero the
 * file is deleted and the guard is retired.
 *
 * Scope: provider-*ID* literals only ("codex", "claude-code", "pi", "acp-…",
 * "cursor") and the id-prefix helpers (`isAcpProviderId`, `startsWith("acp-")`,
 * `providerId === "…"`). Tool-name keying (thread-view's Read/Task/TodoWrite
 * tables) is a separate concern retired by its own workstream, not counted
 * here — those literals collide with unrelated identifiers and would make the
 * ratchet noisy.
 *
 * Usage:
 *   node scripts/check-provider-literal-ratchet.mjs           # check (CI)
 *   node scripts/check-provider-literal-ratchet.mjs --write   # regenerate baseline
 *   node scripts/check-provider-literal-ratchet.mjs --list    # print every hit
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASELINE_PATH = join(ROOT, "scripts", "provider-literal-baseline.json");

// Directories scanned. Everything else in the repo is out of scope.
const SCAN_ROOTS = ["apps", "packages", "plugins"];

// A path segment anywhere in the relative path excludes the file.
const EXCLUDED_SEGMENTS = new Set([
  "node_modules", "dist", "build", "generated", "bundled-types",
  "__fixtures__", "__snapshots__", "test", "tests", "e2e", ".turbo", ".ladle", ".storybook", "stories",
]);
// Provider plugins legitimately name their own provider; examples are teaching
// code. Neither is "core".
const EXCLUDED_PREFIXES = [
  join("plugins", "provider-"),
  join("examples", ""),
];
const EXCLUDED_FILE_RE = /\.(test|spec|stories)\.[cm]?tsx?$|\.snap$|\.d\.ts$/;
const INCLUDED_FILE_RE = /\.[cm]?tsx?$/;

// The literals that constitute a provider-id carve-out. Each is a RegExp run
// per line; a line with any match counts once toward the file.
const PATTERNS = [
  /["'](codex|claude-code|pi|acp-cursor|acp-opencode|acp-omp|acp-grok|acp-hermes|acp-pi-acp)["']/,
  /["']acp-[a-z0-9-]+["']/,
  /providerId\s*[=!]==?\s*["']/,
  /provider\.id\s*[=!]==?\s*["']/,
  /\bstartsWith\(\s*["']acp-/,
  /\bisAcpProviderId\b/,
  /\bACP_ID_PREFIX\b/,
  /\bCODEX_PROVIDER_ID\b|\bCLAUDE_CODE_PROVIDER_ID\b/,
  /\bRESERVED_PROVIDER_ID_OWNERS\b|\bPRODUCT_PROVIDER_ORDER\b|\bPRODUCT_DEFAULT_PROVIDER_ID\b/,
  /\bDAEMON_BUNDLED_PROVIDER_BRIDGE_IDS\b/,
];
// A line matching this is a comment naming a provider only to explain generic
// behavior — not a branch. We still count it (comments drift), but callers can
// see the split with --list.
const COMMENT_RE = /^\s*(\/\/|\*|\/\*)/;

function isExcludedDir(relPath) {
  const parts = relPath.split(sep);
  return parts.some((p) => EXCLUDED_SEGMENTS.has(p));
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = relative(ROOT, abs);
    if (entry.isDirectory()) {
      if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
      walk(abs, out);
    } else if (entry.isFile()) {
      if (!INCLUDED_FILE_RE.test(entry.name)) continue;
      if (EXCLUDED_FILE_RE.test(entry.name)) continue;
      if (isExcludedDir(rel)) continue;
      if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
      out.push({ abs, rel: rel.split(sep).join("/") });
    }
  }
}

function scan() {
  const files = [];
  for (const root of SCAN_ROOTS) walk(join(ROOT, root), files);
  const counts = {};
  const hits = [];
  for (const { abs, rel } of files) {
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (!text.includes("codex") && !text.includes("claude") &&
        !text.includes("acp") && !text.includes("\"pi\"") &&
        !text.includes("'pi'") && !text.includes("cursor") &&
        !text.includes("providerId") && !text.includes("provider.id")) {
      continue; // fast reject
    }
    const lines = text.split("\n");
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (PATTERNS.some((re) => re.test(line))) {
        count++;
        hits.push({ rel, line: i + 1, text: line.trim().slice(0, 140), comment: COMMENT_RE.test(line) });
      }
    }
    if (count > 0) counts[rel] = count;
  }
  return { counts, hits };
}

const args = new Set(process.argv.slice(2));
const { counts, hits } = scan();
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (args.has("--list")) {
  for (const h of hits) {
    console.log(`${h.comment ? "cmt " : "code"} ${h.rel}:${h.line}  ${h.text}`);
  }
  console.log(`\n${total} provider-id literals across ${Object.keys(counts).length} core files`);
  process.exit(0);
}

if (args.has("--write")) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  const payload = {
    _comment: "Provider-literal ratchet (G1). Per-file count of provider-ID literals in core. This may only go DOWN. Regenerate with: node scripts/check-provider-literal-ratchet.mjs --write. When empty, delete this file and the guard.",
    total,
    files: sorted,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Wrote baseline: ${total} literals across ${Object.keys(counts).length} files.`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch {
  console.error("No baseline found. Run: node scripts/check-provider-literal-ratchet.mjs --write");
  process.exit(2);
}

const base = baseline.files ?? {};
const increased = [];
const newFiles = [];
const decreased = [];
const removed = [];
for (const [rel, count] of Object.entries(counts)) {
  if (!(rel in base)) newFiles.push([rel, count]);
  else if (count > base[rel]) increased.push([rel, base[rel], count]);
  else if (count < base[rel]) decreased.push([rel, base[rel], count]);
}
for (const rel of Object.keys(base)) {
  if (!(rel in counts)) removed.push(rel);
}

const hardFail = increased.length > 0 || newFiles.length > 0;
const driftFail = decreased.length > 0 || removed.length > 0;

if (hardFail) {
  console.error("Provider-literal ratchet FAILED — core gained provider-id carve-outs.\n");
  for (const [rel, was, now] of increased) console.error(`  ↑ ${rel}: ${was} → ${now}`);
  for (const [rel, now] of newFiles) console.error(`  + ${rel}: ${now} (new core file with provider-id literals)`);
  console.error("\nThe migration only removes these. Do not add a provider-id branch to core.");
  console.error("If this is genuinely unavoidable this layer, add it to the baseline with --write AND open a follow-up task to remove it.");
  process.exit(1);
}

if (driftFail) {
  console.error("Provider-literal ratchet: literals DECREASED but the baseline was not regenerated.\n");
  for (const [rel, was, now] of decreased) console.error(`  ↓ ${rel}: ${was} → ${now}`);
  for (const rel of removed) console.error(`  − ${rel}: gone`);
  console.error(`\nGood — that is the goal. Lock it in: node scripts/check-provider-literal-ratchet.mjs --write`);
  console.error("Commit the updated baseline so the reduction is recorded.");
  process.exit(1);
}

console.log(`Provider-literal ratchet OK: ${total} literals across ${Object.keys(counts).length} core files (baseline total ${baseline.total}).`);
process.exit(0);
