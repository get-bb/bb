import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { AutomationScriptInterpreter } from "@bb/domain";
import { resolveContainedPath } from "@bb/process-utils";
import { ApiError } from "../../errors.js";

const SCRIPT_DIR_NAME = "automation-scripts";
const DEFAULT_SCRIPT_FILE_NAME = "script.sh";

// Default interpreter by extension. node ships with bb; bash/python3 are
// best-effort host tools (run-time failure surfaces if absent).
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

export function automationScriptDir(
  dataDir: string,
  automationId: string,
): string {
  return join(dataDir, SCRIPT_DIR_NAME, automationId);
}

function sanitizeScriptFileName(name: string): string {
  const base = basename(name).replace(/[^a-zA-Z0-9._-]+/gu, "-");
  return base.length > 0 ? base : DEFAULT_SCRIPT_FILE_NAME;
}

export function resolveDefaultInterpreter(
  scriptFile: string,
): AutomationScriptInterpreter {
  const ext = extname(scriptFile).toLowerCase();
  return INTERPRETER_BY_EXTENSION[ext] ?? "bash";
}

export function resolveInterpreterCommand(
  interpreter: AutomationScriptInterpreter,
): string {
  return INTERPRETER_COMMAND[interpreter];
}

/**
 * Persist inline script content under `<dataDir>/automation-scripts/<id>/` and
 * return the stored relative file name. Sanitizes the file name and writes 0o700.
 */
export async function writeInlineAutomationScript(args: {
  dataDir: string;
  automationId: string;
  content: string;
  scriptFile?: string;
}): Promise<string> {
  const storedName = sanitizeScriptFileName(
    args.scriptFile ?? DEFAULT_SCRIPT_FILE_NAME,
  );
  const dir = automationScriptDir(args.dataDir, args.automationId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, storedName), args.content, { mode: 0o700 });
  return storedName;
}

/**
 * Resolve the absolute path of an automation script, enforcing containment under
 * the automation's script dir (rejecting traversal and symlink escapes).
 */
export async function resolveAutomationScriptPath(args: {
  dataDir: string;
  automationId: string;
  scriptFile: string;
}): Promise<string> {
  const dir = automationScriptDir(args.dataDir, args.automationId);
  const contained = resolveContainedPath({
    rootPath: dir,
    candidatePath: resolve(dir, args.scriptFile),
  });
  if (contained === null) {
    throw new ApiError(
      400,
      "invalid_request",
      "Script file path escapes the automation script directory",
    );
  }
  // realpath both root and candidate to reject symlink escapes (the string-only
  // containment helper cannot detect them).
  let realRoot: string;
  let realCandidate: string;
  try {
    realRoot = await realpath(dir);
    realCandidate = await realpath(contained);
  } catch {
    throw new ApiError(404, "invalid_request", "Script file was not found");
  }
  const reContained = resolveContainedPath({
    rootPath: realRoot,
    candidatePath: realCandidate,
  });
  if (reContained === null) {
    throw new ApiError(
      400,
      "invalid_request",
      "Script file path escapes the automation script directory",
    );
  }
  return reContained;
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
