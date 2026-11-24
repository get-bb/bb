#!/usr/bin/env node
/**
 * Redact bridge recordings (docs/provider-bridge-protocol.md, "Record mode")
 * so they can be committed as fixtures.
 *
 *   node scripts/provider-recordings/redact.mjs <in-dir> <out-dir> [--home <dir>]
 *
 * Every `*.ndjson` under <in-dir> is rewritten under <out-dir> at the same
 * relative path; other files are copied. For each entry the recorded `line`
 * (or, for a converted transcript, the bare message line) is rewritten:
 *
 *   1. structurally (when it parses as JSON): provider tool and command
 *      catalogs collapse to names, `env`/`envVars` maps lose secret-shaped
 *      keys and the record-mode variable, and any string longer than
 *      MAX_STRING_CHARS keeps its head and tail around a marker;
 *   2. textually: absolute paths under the home directory become
 *      `/home/user`, emails become `user@example.com`, and token shapes
 *      (bbde_, GitHub gh[pousr]_/github_pat_, sk-, sk-ant-, xox?-, JWTs,
 *      bearer values, Authorization headers) are replaced by
 *      `<prefix>REDACTED`.
 *
 * The script is idempotent: a redacted file rewrites to itself. After writing
 * it sweeps the output for every pattern again and exits 3 if anything
 * survived, so a new secret shape fails loudly instead of landing in git.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
  copyFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { randomUUID } from "node:crypto";

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
  /gh[pousr]_[A-Za-z0-9._-]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9])xai-[A-Za-z0-9_-]{16,}/g,
  /xox[abprs]-[A-Za-z0-9-]{20,}/g,
  /bbcm_[A-Za-z0-9_-]{16,}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /(?<=[Bb]earer\s+)[A-Za-z0-9._~+/-]{20,}=*/g,
];
/** `"Authorization": "<value>"` in JSON, with or without JSON escaping. */
const AUTHORIZATION_PATTERN =
  /("|\\")[Aa]uthorization\1\s*:\s*("|\\")(?:(?!\2)[^\\]|\\.)*\2/g;
const EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const SECRET_ENV_KEY =
  /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|AUTH)/i;
const RECORD_DIR_ENV = "BB_PROVIDER_BRIDGE_RECORD_DIR";
const PRESERVED_ENV_VALUES = new Map([
  ["GROK_ACTIVE_AGENT_MESSAGES", "1"],
  ["FAKE_ACP_GROK_SUBAGENT_KEEP_RUNNING", "1"],
]);
const GROK_SUBAGENT_ACTION_PROMPT =
  /^Use (?:send_subagent_message|kill_command_or_subagent) with /;
const GROK_SYNTHETIC_SUBAGENT_MESSAGE = "CHILD_MESSAGE 😀 مراجعة";
const GROK_SYNTHETIC_SUBAGENT_MESSAGES = new Set([
  GROK_SYNTHETIC_SUBAGENT_MESSAGE,
]);
const GROK_SYNTHETIC_INTERJECT_TEXTS = new Set([
  "INTERJECT_FIRST 😀",
  "INTERJECT_SECOND مراجعة",
  "INTERJECT_FIRST 😀 مراجعة",
]);
const PRESERVED_RAW_INPUT_KEYS = ["subagent_id", "task_id", "delivery"];
const GROK_SYNTHETIC_SPAWN_RESULTS = new Set([
  "Subagent started in background.\nsubagent_id: child-alpha\ndescription: CHILD_ALPHA",
  "Subagent started in background.\nsubagent_id: child-beta\ndescription: CHILD_BETA",
]);

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
  const characters = Array.from(value);
  const head = characters.slice(0, HEAD_CHARS).join("");
  const tail = characters.slice(-TAIL_CHARS).join("");
  const trimmed = characters.length - HEAD_CHARS - TAIL_CHARS;
  return `${head}\n${TRIM_MARKER} ${trimmed} chars trimmed⟧\n${tail}`;
}

function namesOnly(list) {
  if (!Array.isArray(list)) return list;
  return list.map((entry) =>
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.name === "string"
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

function isSecretShapedKey(key) {
  return key !== "authMethods" && SECRET_ENV_KEY.test(key);
}

function isEnvMap(key, value) {
  return (
    (key === "env" || key === "envVars" || key === "environment") &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isProtocolDeltaKey(key, value) {
  return (
    key === "key" &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (typeof value.providerItemId === "string" ||
      typeof value.channel === "string") &&
    Object.keys(value).every(
      (childKey) => childKey === "providerItemId" || childKey === "channel",
    )
  );
}

function redactAllStrings(value) {
  if (typeof value === "string") return "REDACTED";
  if (Array.isArray(value)) return value.map(redactAllStrings);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        redactAllStrings(child),
      ]),
    );
  }
  return value;
}

function redactUserContent(value) {
  if (typeof value === "string") {
    return GROK_SYNTHETIC_SUBAGENT_MESSAGES.has(value)
      ? value
      : "REDACTED_TEXT";
  }
  if (Array.isArray(value)) return value.map(redactUserContent);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        key === "type" || key === "kind" ? child : redactUserContent(child),
      ]),
    );
  }
  return value;
}

function redactEnvMap(map) {
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    if (key === RECORD_DIR_ENV) continue;
    out[key] =
      PRESERVED_ENV_VALUES.get(key) === value ? value : redactAllStrings(value);
  }
  return out;
}

const USER_CONTENT_KEYS = new Set([
  "text",
  "rawInput",
  "rawOutput",
  "content",
  "summary_preview",
  "planContent",
  "comments",
]);

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
    const list =
      catalogContext && CATALOG_KEYS.has(key) ? namesOnly(value) : value;
    return list.map((entry) => redactValue(entry, key, catalogContext));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (isEnvMap(childKey, childValue)) {
        out[childKey] = redactEnvMap(childValue);
      } else if (isProtocolDeltaKey(childKey, childValue)) {
        out[childKey] = redactValue(childValue, childKey, catalogContext);
      } else if (isSecretShapedKey(childKey)) {
        out[childKey] = redactAllStrings(childValue);
      } else if (USER_CONTENT_KEYS.has(childKey)) {
        out[childKey] = redactUserContent(childValue);
      } else {
        out[childKey] = redactValue(childValue, childKey, catalogContext);
      }
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

function preserveGrokToolResults(value, redacted) {
  if (Array.isArray(value)) {
    if (!Array.isArray(redacted)) return;
    for (let index = 0; index < value.length; index += 1) {
      preserveGrokToolResults(value[index], redacted[index]);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (
    redacted === null ||
    typeof redacted !== "object" ||
    Array.isArray(redacted)
  ) {
    return;
  }
  if (
    value.rawInput !== null &&
    typeof value.rawInput === "object" &&
    value.rawInput.variant === "Task" &&
    redacted.rawInput !== null &&
    typeof redacted.rawInput === "object"
  ) {
    redacted.rawInput.variant = "Task";
  }
  if (
    value.rawInput !== null &&
    typeof value.rawInput === "object" &&
    !Array.isArray(value.rawInput) &&
    redacted.rawInput !== null &&
    typeof redacted.rawInput === "object" &&
    !Array.isArray(redacted.rawInput)
  ) {
    for (const key of PRESERVED_RAW_INPUT_KEYS) {
      const original = value.rawInput[key];
      if (typeof original === "string" && original.length > 0) {
        redacted.rawInput[key] = original;
      }
    }
    const taskIds = value.rawInput.task_ids;
    if (
      Array.isArray(taskIds) &&
      taskIds.every((entry) => typeof entry === "string" && entry.length > 0)
    ) {
      redacted.rawInput.task_ids = [...taskIds];
    }
  }
  const rawOutput = value.rawOutput;
  const redactedOutput = redacted.rawOutput;
  if (
    rawOutput !== null &&
    typeof rawOutput === "object" &&
    redactedOutput !== null &&
    typeof redactedOutput === "object"
  ) {
    if (
      rawOutput.type === "Text" &&
      typeof rawOutput.text === "string" &&
      GROK_SYNTHETIC_SPAWN_RESULTS.has(rawOutput.text)
    ) {
      redactedOutput.text = trimString(rawOutput.text);
    }
    if (rawOutput.type === "SendSubagentMessage") {
      for (const key of ["outcome", "message_id"]) {
        if (typeof rawOutput[key] === "string") {
          redactedOutput[key] = rawOutput[key];
        }
      }
    }
    if (
      rawOutput.type === "KillTask" &&
      rawOutput.Result !== null &&
      typeof rawOutput.Result === "object" &&
      redactedOutput.Result !== null &&
      typeof redactedOutput.Result === "object"
    ) {
      for (const key of ["task_id", "outcome", "message"]) {
        if (typeof rawOutput.Result[key] === "string") {
          redactedOutput.Result[key] = rawOutput.Result[key];
        }
      }
    }
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== "rawOutput") preserveGrokToolResults(child, redacted[key]);
  }
}

function preserveLiteralCompactCommand(value, redacted) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      preserveLiteralCompactCommand(value[index], redacted?.[index]);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (redacted === null || typeof redacted !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "text" && child === "/compact") {
      redacted[key] = "/compact";
    } else {
      preserveLiteralCompactCommand(child, redacted[key]);
    }
  }
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
  const catalogContext =
    !Array.isArray(parsed) && isClaudeCatalogMessage(parsed);
  const redacted = redactValue(parsed, "", catalogContext);
  preserveGrokToolResults(parsed, redacted);
  preserveLiteralCompactCommand(parsed, redacted);
  if (
    !Array.isArray(parsed) &&
    ((parsed.method === "_x.ai/interject" &&
      GROK_SYNTHETIC_INTERJECT_TEXTS.has(parsed.params?.text)) ||
      (parsed.method === "subagent/tell" &&
        GROK_SYNTHETIC_SUBAGENT_MESSAGES.has(parsed.params?.text))) &&
    typeof parsed.params?.text === "string" &&
    redacted.params !== null &&
    typeof redacted.params === "object"
  ) {
    redacted.params.text = trimString(parsed.params.text);
  }
  if (
    !Array.isArray(parsed) &&
    parsed.method === "session/prompt" &&
    Array.isArray(parsed.params?.prompt) &&
    Array.isArray(redacted.params?.prompt)
  ) {
    for (const [index, item] of parsed.params.prompt.entries()) {
      if (
        item?.type === "text" &&
        typeof item.text === "string" &&
        GROK_SUBAGENT_ACTION_PROMPT.test(item.text) &&
        (item.text.includes(GROK_SYNTHETIC_SUBAGENT_MESSAGE) ||
          item.text.includes('task_ids=["child-alpha"]')) &&
        redacted.params.prompt[index] !== null &&
        typeof redacted.params.prompt[index] === "object"
      ) {
        redacted.params.prompt[index].text = trimString(item.text);
      }
    }
  }
  if (
    !Array.isArray(parsed) &&
    parsed.method === "turn/steer" &&
    Array.isArray(parsed.params?.input) &&
    Array.isArray(redacted.params?.input)
  ) {
    for (const [index, item] of parsed.params.input.entries()) {
      if (
        item?.type === "text" &&
        typeof item.text === "string" &&
        item.text.trim() === "" &&
        redacted.params.input[index] !== null &&
        typeof redacted.params.input[index] === "object"
      ) {
        redacted.params.input[index].text = item.text;
      }
    }
  }
  return JSON.stringify(redacted);
}

// ---------------------------------------------------------------------------
// Textual pass
// ---------------------------------------------------------------------------

function createTextRedactor(home) {
  const homePattern = new RegExp(escapeRegExp(home), "g");
  // Claude Code names its per-project transcript directories and task output
  // paths after the cwd with every `/` turned into `-` (`-home-user-…`).
  const dashedHome = home.replace(/\//g, "-");
  const dashedHomePattern = new RegExp(escapeRegExp(dashedHome), "g");
  const dashedRedactedHome = REDACTED_HOME.replace(/\//g, "-");
  // `ls -l` owner/group columns name the account even when no path does.
  const userName = home.split("/").filter(Boolean).at(-1) ?? "";
  const ownerPattern =
    userName === ""
      ? null
      : new RegExp(
          `(\\s)${escapeRegExp(userName)} ${escapeRegExp(userName)}(\\s)`,
          "g",
        );
  return (text) => {
    let out = text
      .replace(homePattern, REDACTED_HOME)
      .replace(dashedHomePattern, dashedRedactedHome);
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
  const dashedHomePattern = new RegExp(
    escapeRegExp(home.replace(/\//g, "-")),
    "g",
  );
  return (text) => {
    const survivors = [];
    for (const pattern of [
      homePattern,
      dashedHomePattern,
      EMAIL_PATTERN,
      AUTHORIZATION_PATTERN,
      ...TOKEN_PATTERNS,
    ]) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const hit = match[0];
        if (
          hit.includes("REDACTED") ||
          hit === REDACTED_EMAIL ||
          hit === REDACTED_HOME
        )
          continue;
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

/**
 * A recording entry wraps the provider line (`{ ts, seq, dir, line }`); a
 * converted transcript (convert-claude-transcript.mjs) is the bare message
 * per line. Both redact the same way.
 */
function redactNdjson(text, redactText) {
  const lines = text.split("\n").filter((line) => line.length > 0);
  const out = [];
  for (const raw of lines) {
    const entry = JSON.parse(raw);
    if (
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.line === "string"
    ) {
      const structural = redactLine(entry.line);
      out.push(JSON.stringify({ ...entry, line: redactText(structural) }));
    } else {
      out.push(redactText(redactLine(raw)));
    }
  }
  return `${out.join("\n")}\n`;
}

function outputContains(parent, child) {
  const fromParent = relative(parent, child);
  return (
    fromParent !== "" &&
    fromParent !== ".." &&
    !fromParent.startsWith(`..${sep}`) &&
    !isAbsolute(fromParent)
  );
}

function canonicalPath(target) {
  const absolute = resolve(target);
  const missing = [];
  let current = absolute;
  for (;;) {
    try {
      const real = realpathSync(current);
      return missing.reduceRight((path, part) => join(path, part), real);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) {
        return absolute;
      }
      missing.push(basename(current));
      current = parent;
    }
  }
}

function main() {
  const { inDir, outDir, home } = parseArgs(process.argv.slice(2));
  if (home === "/" || home === "") {
    throw new Error("refusing to redact with an empty home directory");
  }
  const inputRoot = canonicalPath(inDir);
  const outputRoot = canonicalPath(outDir);
  if (inputRoot === outputRoot) {
    throw new Error("input and output directories must differ");
  }
  if (outputContains(outputRoot, inputRoot)) {
    throw new Error(
      `refusing to replace ${outDir}: it contains the input recordings`,
    );
  }
  const staging = join(
    dirname(outputRoot),
    `.${basename(outputRoot)}.tmp-${process.pid}-${randomUUID()}`,
  );
  const redactText = createTextRedactor(home);
  const sweep = createSurvivorSweep(home);
  let rewritten = 0;
  try {
    const files = walk(inputRoot);
    if (files.length === 0) {
      throw new Error(
        `refusing to replace ${outDir}: the input recordings are empty`,
      );
    }
    const survivors = [];
    for (const file of files) {
      const rel = relative(inputRoot, file);
      const target = join(staging, rel);
      mkdirSync(dirname(target), { recursive: true });
      if (!file.endsWith(".ndjson")) {
        if (file.endsWith(".json")) {
          const text = redactText(readFileSync(file, "utf8"));
          writeFileSync(target, text);
          for (const hit of sweep(text)) survivors.push({ file: rel, hit });
        } else {
          const text = readFileSync(file, "utf8");
          for (const hit of sweep(text)) survivors.push({ file: rel, hit });
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
      throw new Error(
        `refusing to publish recordings: ${survivors.length} potential secret(s) survived redaction`,
      );
    }
    rmSync(outputRoot, { recursive: true, force: true });
    renameSync(staging, outputRoot);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  console.log(
    `redacted ${rewritten} recording files into ${outDir} (home=${home} → ${REDACTED_HOME}); 0 survivors`,
  );
}

main();
