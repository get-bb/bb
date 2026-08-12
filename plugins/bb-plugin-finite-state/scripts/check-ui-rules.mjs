#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRelativePath = "plugins/bb-plugin-finite-state";
const recovery = "file an amendment; do not edit the frozen artifact locally.";
const extensions = new Set([".ts", ".tsx", ".css"]);
const actionToolNames = new Set(["fs_verification_run", "fs_bench_run", "fs_firmware_materialize"]);
const canonicalToolNames = new Set([
  "fs_sync_status",
  "fs_sync_plan",
  "fs_findings_query",
  "fs_triage_set",
  "fs_triage_apply_policy",
  "fs_tara_query",
  "fs_requirement_write",
  "fs_ears_convert",
  "fs_verification_run",
  "fs_sbom_query",
  "fs_hbom_extract",
  "fs_hbom_review",
  "fs_firmware_materialize",
  "fs_bench_run",
  "fs_bench_status",
  "fs_doc_search",
]);
const humanOnlyMethods = new Set([
  "sync.push",
  "sync.push.retry",
  "sync.conflict.resolve",
  "hbom.review.resolve",
  "hbom.extraction.apply",
  "review.transition",
  "verifications.manualAttestation.record",
]);

function fail(message) {
  throw new Error(`${message}\nRecovery: ${recovery}`);
}

function rootFromArguments(argv) {
  if (!argv.length) return path.resolve(scriptDirectory, "../../..");
  if (argv.length === 2 && argv[0] === "--root") return path.resolve(argv[1]);
  fail("Usage: node scripts/check-ui-rules.mjs [--root <repository-root>]");
}

async function sourceFiles(root, directory, includeCss = true) {
  const files = [];
  async function visit(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && extensions.has(path.extname(entry.name)) && (includeCss || path.extname(entry.name) !== ".css")) files.push(fullPath);
    }
  }
  await visit(path.join(root, directory));
  return files;
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

function extractBalanced(source, openingIndex, opening = "{", closing = "}") {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (!escaped && character === quote) quote = null;
      escaped = !escaped && character === "\\";
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) depth -= 1;
    if (depth === 0) return source.slice(openingIndex, index + 1);
  }
  return null;
}

function propertyEntries(objectSource) {
  const entries = [];
  let start = 1;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = 1; index < objectSource.length - 1; index += 1) {
    const character = objectSource[index];
    if (quote) {
      if (!escaped && character === quote) quote = null;
      escaped = !escaped && character === "\\";
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{" || character === "(" || character === "[") depth += 1;
    if (character === "}" || character === ")" || character === "]") depth -= 1;
    if (character === "," && depth === 0) {
      entries.push(objectSource.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(objectSource.slice(start, -1));
  return entries.map((entry) => entry.trim()).filter(Boolean);
}

function literalProperty(objectSource, property) {
  const entry = propertyEntries(objectSource).find((candidate) => new RegExp(`^(?:${property}|["']${property}["'])\\s*:`).test(candidate));
  if (!entry) return null;
  const match = /^[^:]+:\s*["'](?<value>[^"']+)["']\s*$/u.exec(entry);
  return match?.groups?.value ?? null;
}

function callObjects(source, callee) {
  const objects = [];
  let index = 0;
  while ((index = source.indexOf(callee, index)) !== -1) {
    const opening = source.indexOf("{", index + callee.length);
    if (opening === -1) break;
    const objectSource = extractBalanced(source, opening);
    if (!objectSource) break;
    objects.push(objectSource);
    index = opening + objectSource.length;
  }
  return objects;
}

function canonicalToolRegistry(source) {
  const surfaceMarker = /\bAGENT_SURFACE\s*=\s*\{/u.exec(source);
  if (surfaceMarker?.index === undefined) return null;
  const surfaceOpening = source.indexOf("{", surfaceMarker.index);
  const surface = surfaceOpening === -1 ? null : extractBalanced(source, surfaceOpening);
  if (!surface) return null;
  const toolsMarker = surface.indexOf("tools:");
  if (toolsMarker === -1) return null;
  const opening = surface.indexOf("{", toolsMarker);
  const toolsObject = opening === -1 ? null : extractBalanced(surface, opening);
  if (!toolsObject) return null;
  const tools = new Map();
  for (const entry of propertyEntries(toolsObject)) {
    const separator = entry.indexOf(":");
    const objectStart = entry.indexOf("{");
    if (separator === -1 || objectStart === -1) continue;
    const name = entry.slice(0, separator).trim().replace(/^["']|["']$/gu, "");
    const specification = extractBalanced(entry, objectStart);
    const toolClass = specification ? literalProperty(specification, "class") : null;
    if (toolClass) tools.set(name, toolClass);
  }
  return tools;
}

function violationsFor(relativePath, source, registryTools = null) {
  const clean = withoutComments(source);
  const violations = [];
  const isCss = relativePath.endsWith(".css");
  const arbitraryColor = /\b(?:bg|text|border|ring|outline|fill|stroke|decoration|shadow)-\[(?:#[0-9a-fA-F]{3,8}\b|(?:oklch|rgb|rgba|hsl|hsla|color)\()/u;
  const contextualHex = /\b(?:color|background(?:-color)?|border(?:-color)?|fill|stroke|outline(?:-color)?)\s*[:=]\s*["'`]?#(?:[0-9a-fA-F]{3,8})\b/u;
  if ((isCss && /#[0-9a-fA-F]{3,8}\b/u.test(clean)) || (!isCss && (contextualHex.test(clean) || arbitraryColor.test(clean)))) violations.push("raw hex color");
  if (/\boklch\s*\(/u.test(clean)) violations.push("oklch() color");
  if (arbitraryColor.test(clean)) violations.push("arbitrary Tailwind color");
  if (/\bfrom\s*["'](?:lucide-react|@lucide\/[^"']+)["']|\brequire\s*\(\s*["'](?:lucide-react|@lucide\/[^"']+)/u.test(clean)) violations.push("Lucide import");
  if (relativePath.endsWith(".tsx")) {
    if (/>[^<{]*\p{Extended_Pictographic}[^<{]*</u.test(clean) || /["'`][^"'`\n]*\p{Extended_Pictographic}[^"'`\n]*["'`]/u.test(clean)) violations.push("emoji in JSX/text literal");
    if (/\bfrom\s*["'][^"']*(?:\/lib\/remote|@modelcontextprotocol\/sdk|better-sqlite3|node:fs|node:path)[^"']*["']/u.test(clean)) violations.push("frontend import crosses the RPC boundary");
    if (/\b(?:fetch|PlatformClient|AssuranceStudioClient|ForgeComputeClient)\b/u.test(clean)) violations.push("frontend direct-API/compute access");
  }
  for (const objectSource of callObjects(clean, "bb.agents.registerTool")) {
    const name = literalProperty(objectSource, "name");
    if (!name) violations.push("agent registration must use a literal canonical name");
    else if (!registryTools?.has(name)) violations.push(`agent registration is absent from canonical registry: ${name}`);
  }
  for (const callee of ["bb.agents.registerTool", "bb.cli.register"]) {
    for (const objectSource of callObjects(clean, callee)) {
      if ([...humanOnlyMethods].some((method) => objectSource.includes(`"${method}"`) || objectSource.includes(`'${method}'`))) {
        violations.push(`agent/CLI handler exposes human-only mutation: ${callee}`);
      }
    }
  }
  if (/\bfs_sync_push\b/u.test(clean)) violations.push("human-only mutation path");
  return violations;
}

function registryViolation(tools) {
  if (!tools) return "canonical registry is missing or malformed";
  const actions = new Set([...tools].filter(([, toolClass]) => toolClass === "action").map(([name]) => name));
  if (tools.size !== canonicalToolNames.size || [...tools.keys()].some((name) => !canonicalToolNames.has(name))) {
    return `canonical registry must contain exactly the ${canonicalToolNames.size} declared tool names`;
  }
  if (actions.size !== actionToolNames.size || [...actions].some((name) => !actionToolNames.has(name))) {
    return `canonical action-kind set must be exactly ${[...actionToolNames].join(", ")}`;
  }
  return null;
}

async function main() {
  const root = rootFromArguments(process.argv.slice(2));
  const laneDirectory = `${pluginRelativePath}/lanes`;
  const registryPath = path.join(root, pluginRelativePath, "lib/agentic/registry.ts");
  const registrySource = await fs.readFile(registryPath, "utf8").catch((error) => error && typeof error === "object" && "code" in error && error.code === "ENOENT" ? null : Promise.reject(error));
  const registryTools = registrySource ? canonicalToolRegistry(withoutComments(registrySource)) : null;
  const violations = [];
  const registryError = registryViolation(registryTools);
  if (registryError) violations.push(`plugins/bb-plugin-finite-state/lib/agentic/registry.ts: ${registryError}`);
  for (const filePath of await sourceFiles(root, laneDirectory)) {
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    for (const violation of violationsFor(relativePath, await fs.readFile(filePath, "utf8"), registryTools)) violations.push(`${relativePath}: ${violation}`);
  }
  if (violations.length) fail(`Finite State UI/safety rule violations:\n${violations.join("\n")}`);
  process.stdout.write("Finite State UI and lane safety rules are intact.\n");
}

export { canonicalToolRegistry, registryViolation, violationsFor };

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
