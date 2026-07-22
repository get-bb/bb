import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join, resolve, relative } from "node:path";
import type { AutomationScriptInterpreter } from "./rpc-types.js";

const SCRIPT_DIR_NAME = "scripts";
const DEFAULT_SCRIPT_FILE_NAME = "script.sh";

const INTERPRETER_BY_EXTENSION: Record<string, AutomationScriptInterpreter> = {
  ".sh": "bash",
  ".bash": "bash",
  ".js": "node",
  ".mjs": "node",
  ".py": "python3",
};

const INTERPRETER_COMMAND: Record<AutomationScriptInterpreter, string> = {
  bash: "bash",
  sh: "sh",
  node: "node",
  python3: "python3",
};

export function scriptsRoot(dataDir: string): string {
  return join(dataDir, SCRIPT_DIR_NAME);
}

export function automationScriptDir(
  dataDir: string,
  automationId: string,
): string {
  return join(scriptsRoot(dataDir), automationId);
}

function sanitizeScriptFileName(name: string): string {
  const base = basename(name).replace(/[^a-zA-Z0-9._-]+/gu, "-");
  return base.length > 0 ? base : DEFAULT_SCRIPT_FILE_NAME;
}

export function resolveDefaultInterpreter(
  scriptFile: string,
): AutomationScriptInterpreter {
  return INTERPRETER_BY_EXTENSION[extname(scriptFile).toLowerCase()] ?? "bash";
}

export function resolveInterpreterCommand(
  interpreter: AutomationScriptInterpreter,
): string {
  return INTERPRETER_COMMAND[interpreter];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

export async function writeInlineAutomationScript(args: {
  dataDir: string;
  automationId: string;
  content: string;
  scriptFile?: string;
}): Promise<string> {
  const requestedName = sanitizeScriptFileName(
    args.scriptFile ?? DEFAULT_SCRIPT_FILE_NAME,
  );
  const dir = automationScriptDir(args.dataDir, args.automationId);
  await mkdir(dir, { recursive: true });
  let storedName = requestedName;
  if (await pathExists(join(dir, storedName))) {
    const extension = extname(requestedName);
    const stem = requestedName.slice(
      0,
      requestedName.length - extension.length,
    );
    storedName = `${stem}.${randomUUID()}${extension}`;
  }
  const target = join(dir, storedName);
  const tmp = join(dir, `.${storedName}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, args.content, { mode: 0o700 });
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  return storedName;
}

function ensureContained(
  rootPath: string,
  candidatePath: string,
): string | null {
  const rel = relative(rootPath, candidatePath);
  if (
    rel === "" ||
    (!rel.startsWith("..") &&
      !rel.startsWith("/") &&
      !resolve(rel).startsWith(".."))
  ) {
    return candidatePath;
  }
  return null;
}

export async function resolveAutomationScriptPath(args: {
  dataDir: string;
  automationId: string;
  scriptFile: string;
}): Promise<string> {
  const dir = automationScriptDir(args.dataDir, args.automationId);
  const contained = ensureContained(dir, resolve(dir, args.scriptFile));
  if (contained === null) {
    throw new Error("Script file path escapes the automation script directory");
  }
  let realRoot: string;
  let realCandidate: string;
  try {
    realRoot = await realpath(dir);
    realCandidate = await realpath(contained);
  } catch {
    throw new Error("Script file was not found");
  }
  const reContained = ensureContained(realRoot, realCandidate);
  if (reContained === null) {
    throw new Error("Script file path escapes the automation script directory");
  }
  return reContained;
}

export async function readAutomationScript(args: {
  dataDir: string;
  automationId: string;
  scriptFile: string;
}): Promise<string> {
  return readFile(await resolveAutomationScriptPath(args), "utf8");
}

export async function deleteAutomationScriptDir(args: {
  dataDir: string;
  automationId: string;
}): Promise<void> {
  await rm(automationScriptDir(args.dataDir, args.automationId), {
    recursive: true,
    force: true,
  });
}

export async function deleteAutomationScriptFile(args: {
  dataDir: string;
  automationId: string;
  scriptFile: string;
}): Promise<void> {
  const storedName = sanitizeScriptFileName(args.scriptFile);
  if (storedName !== args.scriptFile) {
    throw new Error("Invalid stored automation script filename");
  }
  await rm(
    join(automationScriptDir(args.dataDir, args.automationId), storedName),
    { force: true },
  );
}
