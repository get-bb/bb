import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const defaultRepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const contractPrefix = "packages/host-daemon-contract/src/";
const protocolPath = `${contractPrefix}protocol.ts`;
const unavailablePushBase = /^0{40}$/u;

export function readProtocolVersion(source) {
  const match = source.match(
    /^export const HOST_DAEMON_PROTOCOL_VERSION\s*=\s*(\d+)\s+as\s+const;/mu,
  );
  if (!match) {
    throw new Error(`Could not read HOST_DAEMON_PROTOCOL_VERSION.`);
  }
  return Number.parseInt(match[1], 10);
}

export function normalizeTypeScript(source, fileName = "contract.ts") {
  if (source.length === 0) return "";

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`Could not parse ${fileName}.`);
  }

  return ts
    .createPrinter({ removeComments: true })
    .printFile(sourceFile)
    .trim();
}

export function evaluateProtocolChange({ files, baseSource, headSource }) {
  const changed = files.some(
    ({ path: filePath, before, after }) =>
      normalizeTypeScript(before, filePath) !==
      normalizeTypeScript(after, filePath),
  );
  if (!changed) {
    return { ok: true, reason: "no-contract-change" };
  }

  const baseVersion = readProtocolVersion(baseSource);
  const headVersion = readProtocolVersion(headSource);
  if (headVersion > baseVersion) {
    return { ok: true, reason: "version-increased", baseVersion, headVersion };
  }

  return {
    ok: false,
    reason: "version-not-increased",
    baseVersion,
    headVersion,
  };
}

function git(args, rootDir) {
  return execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readBaseFile(base, filePath, rootDir) {
  try {
    return git(["show", `${base}:${filePath}`], rootDir);
  } catch {
    return "";
  }
}

function readHeadFile(filePath, rootDir) {
  const absolutePath = path.join(rootDir, filePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

export function checkRepository({ baseRef, rootDir = defaultRepoRoot }) {
  if (unavailablePushBase.test(baseRef)) {
    throw new Error("Comparison base is the unavailable all-zero object ID.");
  }

  const base = git(["merge-base", baseRef, "HEAD"], rootDir).trim();
  const trackedChanges = git(
    ["diff", "--no-renames", "--name-only", base],
    rootDir,
  ).split("\n");
  const untrackedChanges = git(
    ["ls-files", "--others", "--exclude-standard", contractPrefix],
    rootDir,
  ).split("\n");
  const changedFiles = [
    ...new Set([...trackedChanges, ...untrackedChanges]),
  ].filter((file) => file.startsWith(contractPrefix));

  if (changedFiles.length === 0) {
    return { ok: true, reason: "no-contract-files" };
  }

  return evaluateProtocolChange({
    files: changedFiles.map((filePath) => ({
      path: filePath,
      before: readBaseFile(base, filePath, rootDir),
      after: readHeadFile(filePath, rootDir),
    })),
    baseSource: readBaseFile(base, protocolPath, rootDir),
    headSource: readHeadFile(protocolPath, rootDir),
  });
}

export function run({
  args = process.argv.slice(2),
  rootDir = defaultRepoRoot,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const baseRef = args[0];
  if (!baseRef) {
    stderr(
      "Usage: node scripts/check-host-daemon-protocol-version.mjs <base-ref>",
    );
    return 2;
  }

  let result;
  try {
    result = checkRepository({ baseRef, rootDir });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`Host daemon protocol comparison failed: ${message}`);
    return 2;
  }

  if (result.reason === "no-contract-files") {
    stdout("Host daemon contract package unchanged.");
    return 0;
  }

  if (result.ok) {
    if (result.reason === "version-increased") {
      stdout(
        `Host daemon protocol version increased: ${result.baseVersion} -> ${result.headVersion}.`,
      );
    } else {
      stdout("Host daemon contract package has documentation-only changes.");
    }
    return 0;
  }

  stderr(
    [
      `Host daemon contract code changed without increasing HOST_DAEMON_PROTOCOL_VERSION (${result.baseVersion}).`,
      `Update ${protocolPath} and describe the compatibility change above the constant.`,
      "This check covers the contract package; apply the broader semantic-change rule in AGENTS.md during review.",
    ].join("\n"),
  );
  return 1;
}

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = run();
}
