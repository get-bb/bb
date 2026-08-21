#!/usr/bin/env node
/**
 * Redact bridge recordings (docs/provider-bridge-protocol.md, "Record mode")
 * so they can be committed as fixtures.
 *
 *   node scripts/provider-recordings/redact.mjs <in-dir> <out-dir> [--home <dir>]
 *
 * Every `*.ndjson` under <in-dir> is rewritten under <out-dir> at the same
 * relative path; other files are copied. For each entry the recorded `line`
 * is rewritten:
 *
 *   1. structurally (when it parses as JSON): provider tool and command
 *      catalogs collapse to names, `env`/`envVars` maps lose secret-shaped
 *      keys and the record-mode variable, and any string longer than
 *      MAX_STRING_CHARS keeps its head and tail around a marker;
 *   2. textually: absolute paths under the home directory become
 *      `/home/user`, emails become `user@example.com`, and token shapes
 *      (bbde_, ghp_, github_pat_, sk-, sk-ant-, xox?-, JWTs, bearer values,
 *      Authorization headers) are replaced by `<prefix>REDACTED`.
 *
 * The script is idempotent: a redacted file rewrites to itself. After writing
 * it sweeps the output for every pattern again and exits 3 if anything
 * survived, so a new secret shape fails loudly instead of landing in git.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

const MAX_STRING_CHARS = 2_000;
const HEAD_CHARS = 1_400;
const TAIL_CHARS = 300;
const TRIM_MARKER = "⟦redacted:";

const REDACTED_HOME = "/home/user";
const REDACTED_EMAIL = "user@example.com";

/** Token shapes. Each match is replaced by its prefix (up to the first `_` or
 * `-` run) plus `REDACTED`, so a reader still sees what kind of secret it was. */
const TOKEN_PATTERNS = [
  /bbde_[A-Za-z0-9]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/g,
  /xox[abprs]-[A-Za-z0-9-]{20,}/g,
  /bbcm_[A-Za-z0-9_-]{16,}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /(?<=[Bb]earer\s+)[A-Za-z0-9._~+/-]{20,}=*/g,
];
/** `"Authorization": "<value>"` in JSON, with or without JSON escaping. */
const AUTHORIZATION_PATTERN =
  /("|\\")[Aa]uthorization\1\s*:\s*("|\\")(?:(?!\2)[^\\]|\\.)*\2/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const SECRET_ENV_KEY = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|AUTH)/i;
const RECORD_DIR_ENV = "BB_PROVIDER_BRIDGE_RECORD_DIR";

function parseArgs(argv) {
  const positional = [];
  let home = homedir();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--home") {
      home = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) {
    throw new Error("usage: redact.mjs <in-dir> <out-dir> [--home <dir>]");
  }
  return { inDir: positional[0], outDir: positional[1], home };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Structural pass
// ---------------------------------------------------------------------------

function trimString(value) {
  if (value.length <= MAX_STRING_CHARS || value.includes(TRIM_MARKER)) {
    return value;
  }
  const trimmed = value.length - HEAD_CHARS - TAIL_CHARS;
  return `${value.slice(0, HEAD_CHARS)}\n${TRIM_MARKER} ${trimmed} chars trimmed⟧\n${value.slice(-TAIL_CHARS)}`;
}

function namesOnly(list) {
  if (!Array.isArray(list)) return list;
  return list.map((entry) =>
    entry !== null && typeof entry === "object" && typeof entry.name === "string"
      ? entry.name
      : entry,
  );
}

const CATALOG_KEYS = new Set([
  "tools",
  "slash_commands",
  "skills",
  "plugins",
  "agents",
  "mcp_servers",
  "commands",
]);

function isEnvMap(key, value) {
  return (
    (key === "env" || key === "envVars" || key === "environment") &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function redactEnvMap(map) {
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    if (key === RECORD_DIR_ENV) continue;
    out[key] = SECRET_ENV_KEY.test(key) && typeof value === "string" && value !== ""
      ? "REDACTED"
      : value;
  }
  return out;
}

/**
 * Walk one decoded message. `catalogContext` is true inside a Claude
 * `system/init` message or a `control_response` body, where the catalogs the
 * CLI advertises (tools, commands, skills…) collapse to their names.
 */
function redactValue(value, key, catalogContext) {
  if (typeof value === "string") {
    return trimString(value);
  }
  if (Array.isArray(value)) {
    const list = catalogContext && CATALOG_KEYS.has(key) ? namesOnly(value) : value;
    return list.map((entry) => redactValue(entry, key, catalogContext));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (isEnvMap(childKey, childValue)) {
        out[childKey] = redactEnvMap(childValue);
        continue;
      }
      out[childKey] = redactValue(childValue, childKey, catalogContext);
    }
    return out;
  }
  return value;
}

function isClaudeCatalogMessage(message) {
  return (
    (message.type === "system" && message.subtype === "init") ||
    message.type === "control_response"
  );
}

function redactLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return trimString(line);
  }
  if (parsed === null || typeof parsed !== "object") {
    return line;
  }
  const catalogContext = !Array.isArray(parsed) && isClaudeCatalogMessage(parsed);
  return JSON.stringify(redactValue(parsed, "", catalogContext));
}

// ---------------------------------------------------------------------------
// Textual pass
// ---------------------------------------------------------------------------

function createTextRedactor(home) {
  const homePattern = new RegExp(escapeRegExp(home), "g");
  // `ls -l` owner/group columns name the account even when no path does.
  const userName = home.split("/").filter(Boolean).at(-1) ?? "";
  const ownerPattern =
    userName === ""
      ? null
      : new RegExp(`(\\s)${escapeRegExp(userName)} ${escapeRegExp(userName)}(\\s)`, "g");
  return (text) => {
    let out = text.replace(homePattern, REDACTED_HOME);
    if (ownerPattern !== null) {
      out = out.replace(ownerPattern, "$1user user$2");
    }
    out = out.replace(EMAIL_PATTERN, (match) =>
      match === REDACTED_EMAIL ? match : REDACTED_EMAIL,
    );
    out = out.replace(AUTHORIZATION_PATTERN, (match, quote) => {
      const q = quote;
      return `${q}Authorization${q}: ${q}REDACTED${q}`;
    });
    for (const pattern of TOKEN_PATTERNS) {
      out = out.replace(pattern, (match) => {
        if (match.includes("REDACTED")) return match;
        const prefix = /^[A-Za-z0-9]+[_-]/.exec(match);
        return `${prefix ? prefix[0] : ""}REDACTED`;
      });
    }
    return out;
  };
}

function createSurvivorSweep(home) {
  const homePattern = new RegExp(escapeRegExp(home), "g");
  return (text) => {
    const survivors = [];
    for (const pattern of [homePattern, EMAIL_PATTERN, AUTHORIZATION_PATTERN, ...TOKEN_PATTERNS]) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const hit = match[0];
        if (hit.includes("REDACTED") || hit === REDACTED_EMAIL || hit === REDACTED_HOME) continue;
        survivors.push(hit.slice(0, 24));
      }
    }
    return survivors;
  };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function redactNdjson(text, redactText) {
  const lines = text.split("\n").filter((line) => line.length > 0);
  const out = [];
  for (const raw of lines) {
    const entry = JSON.parse(raw);
    const structural = redactLine(entry.line);
    out.push(JSON.stringify({ ...entry, line: redactText(structural) }));
  }
  return `${out.join("\n")}\n`;
}

function main() {
  const { inDir, outDir, home } = parseArgs(process.argv.slice(2));
  if (home === "/" || home === "") {
    throw new Error("refusing to redact with an empty home directory");
  }
  const redactText = createTextRedactor(home);
  const sweep = createSurvivorSweep(home);
  const files = walk(inDir);
  let rewritten = 0;
  const survivors = [];
  for (const file of files) {
    const rel = relative(inDir, file);
    const target = join(outDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    if (!file.endsWith(".ndjson")) {
      if (file.endsWith(".json")) {
        const text = redactText(readFileSync(file, "utf8"));
        writeFileSync(target, text);
        for (const hit of sweep(text)) survivors.push({ file: rel, hit });
      } else {
        copyFileSync(file, target);
      }
      continue;
    }
    const redacted = redactNdjson(readFileSync(file, "utf8"), redactText);
    writeFileSync(target, redacted);
    rewritten += 1;
    for (const hit of sweep(redacted)) survivors.push({ file: rel, hit });
  }
  if (survivors.length > 0) {
    console.error("SECRETS STILL PRESENT after redaction — refusing to continue:");
    for (const { file, hit } of survivors.slice(0, 20)) {
      console.error(`  ${file}: ${hit}`);
    }
    process.exit(3);
  }
  console.log(`redacted ${rewritten} recording files into ${outDir} (home=${home} → ${REDACTED_HOME}); 0 survivors`);
}

main();
