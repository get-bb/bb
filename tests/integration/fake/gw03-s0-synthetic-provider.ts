import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import { fakeProviderScriptPath } from "@bb/agent-runtime/test";

interface SyntheticFilesystemPolicy {
  additionalWorkspaceWriteRoots: string[];
  workspaceReadOnly: boolean;
}

type SyntheticFilesystemAction =
  | {
      content: string;
      operation: "write";
      path: string;
      receiptPath: string;
    }
  | {
      operation: "copy";
      receiptPath: string;
      sourcePath: string;
      targetPath: string;
    }
  | {
      args: string[];
      cwd: string;
      executable: "chmod" | "git";
      operation: "exec";
      receiptPath: string;
      stdin?: string;
    }
  | {
      operation: "spawn_child";
      parentThreadId: string;
      receiptPath: string;
      request: Record<string, unknown>;
    }
  | {
      content: string;
      cwd: string;
      operation: "escape_exec";
      receiptPath: string;
      targetPath: string;
      vector: "environment_variable" | "tool_path_alias";
    };

const POLICY_ENV = "GW03_SYNTHETIC_FILESYSTEM_POLICY";
const ACTION = /(?:^|\s)gw03_fs:([A-Za-z0-9_-]+)(?:\s|$)/u;

class SyntheticFilesystemPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyntheticFilesystemPolicyError";
  }
}

function parsePolicy(): SyntheticFilesystemPolicy {
  const raw = process.env[POLICY_ENV];
  if (!raw) throw new Error(`Missing ${POLICY_ENV}`);
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "object" ||
    value === null ||
    !("workspaceReadOnly" in value) ||
    typeof value.workspaceReadOnly !== "boolean" ||
    !("additionalWorkspaceWriteRoots" in value) ||
    !Array.isArray(value.additionalWorkspaceWriteRoots) ||
    value.additionalWorkspaceWriteRoots.some(
      (root) => typeof root !== "string" || !path.isAbsolute(root),
    )
  ) {
    throw new Error(`Invalid ${POLICY_ENV}`);
  }
  return {
    workspaceReadOnly: value.workspaceReadOnly,
    additionalWorkspaceWriteRoots: [...value.additionalWorkspaceWriteRoots],
  };
}

function parseAction(input: unknown): SyntheticFilesystemAction | null {
  if (!Array.isArray(input)) return null;
  const text = input
    .filter(
      (item): item is { type: "text"; text: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string",
    )
    .map((item) => item.text)
    .join(" ");
  const encoded = ACTION.exec(text)?.[1];
  if (!encoded) return null;
  const value: unknown = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  );
  if (
    typeof value !== "object" ||
    value === null ||
    !("operation" in value) ||
    !("receiptPath" in value) ||
    typeof value.receiptPath !== "string"
  ) {
    throw new Error("Invalid synthetic filesystem action");
  }
  if (
    value.operation === "write" &&
    "path" in value &&
    typeof value.path === "string" &&
    "content" in value &&
    typeof value.content === "string"
  ) {
    return {
      operation: "write",
      path: value.path,
      content: value.content,
      receiptPath: value.receiptPath,
    };
  }
  if (
    value.operation === "copy" &&
    "sourcePath" in value &&
    typeof value.sourcePath === "string" &&
    "targetPath" in value &&
    typeof value.targetPath === "string"
  ) {
    return {
      operation: "copy",
      sourcePath: value.sourcePath,
      targetPath: value.targetPath,
      receiptPath: value.receiptPath,
    };
  }
  if (
    value.operation === "exec" &&
    "executable" in value &&
    (value.executable === "git" || value.executable === "chmod") &&
    "cwd" in value &&
    typeof value.cwd === "string" &&
    "args" in value &&
    Array.isArray(value.args) &&
    value.args.every((argument) => typeof argument === "string") &&
    (!("stdin" in value) || typeof value.stdin === "string")
  ) {
    return {
      operation: "exec",
      executable: value.executable,
      cwd: value.cwd,
      args: [...value.args],
      receiptPath: value.receiptPath,
      ...("stdin" in value ? { stdin: value.stdin as string } : {}),
    };
  }
  if (
    value.operation === "spawn_child" &&
    "parentThreadId" in value &&
    typeof value.parentThreadId === "string" &&
    value.parentThreadId.length > 0 &&
    "request" in value &&
    typeof value.request === "object" &&
    value.request !== null &&
    !Array.isArray(value.request)
  ) {
    return {
      operation: "spawn_child",
      parentThreadId: value.parentThreadId,
      receiptPath: value.receiptPath,
      request: value.request as Record<string, unknown>,
    };
  }
  if (
    value.operation === "escape_exec" &&
    "vector" in value &&
    (value.vector === "environment_variable" ||
      value.vector === "tool_path_alias") &&
    "cwd" in value &&
    typeof value.cwd === "string" &&
    "targetPath" in value &&
    typeof value.targetPath === "string" &&
    "content" in value &&
    typeof value.content === "string"
  ) {
    return {
      operation: "escape_exec",
      vector: value.vector,
      cwd: value.cwd,
      targetPath: value.targetPath,
      content: value.content,
      receiptPath: value.receiptPath,
    };
  }
  throw new Error("Invalid synthetic filesystem action");
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function rejectSyntacticEscape(inputPath: string): void {
  if (inputPath.includes("\0") || inputPath.split(/[\\/]+/u).includes("..")) {
    throw new SyntheticFilesystemPolicyError("Path traversal is denied");
  }
}

async function canonicalPathForAccess(
  inputPath: string,
  mode: "read" | "write",
): Promise<string> {
  rejectSyntacticEscape(inputPath);
  const absolutePath = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(process.cwd(), inputPath);
  if (absolutePath.split(path.sep).includes(".git")) {
    throw new SyntheticFilesystemPolicyError("Git metadata access is denied");
  }

  if (mode === "read") {
    return fs.realpath(absolutePath);
  }

  try {
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new SyntheticFilesystemPolicyError("Symlink writes are denied");
    }
    return fs.realpath(absolutePath);
  } catch (error) {
    if (
      error instanceof SyntheticFilesystemPolicyError ||
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    const parent = await fs.realpath(path.dirname(absolutePath));
    return path.join(parent, path.basename(absolutePath));
  }
}

async function requireAllowedPath(
  inputPath: string,
  mode: "read" | "write",
  policy: SyntheticFilesystemPolicy,
): Promise<string> {
  const workspaceRoot = await fs.realpath(process.cwd());
  const additionalRoots = await Promise.all(
    policy.additionalWorkspaceWriteRoots.map((root) => fs.realpath(root)),
  );
  const roots =
    mode === "read"
      ? [workspaceRoot, ...additionalRoots]
      : [
          ...(policy.workspaceReadOnly ? [] : [workspaceRoot]),
          ...additionalRoots,
        ];
  const candidate = await canonicalPathForAccess(inputPath, mode);
  if (!roots.some((root) => isWithin(root, candidate))) {
    throw new SyntheticFilesystemPolicyError(
      `${mode} is outside the profile roots`,
    );
  }
  return candidate;
}

async function securedWrite(
  filePath: string,
  content: string,
  policy: SyntheticFilesystemPolicy,
): Promise<void> {
  const target = await requireAllowedPath(filePath, "write", policy);
  await fs.writeFile(target, content, { encoding: "utf8", flag: "w" });
}

async function runSandboxedCommand(
  action: Extract<SyntheticFilesystemAction, { operation: "exec" }>,
  policy: SyntheticFilesystemPolicy,
): Promise<{
  error: "command_failed" | null;
  exitCode: number;
  ok: boolean;
  stderr: string;
}> {
  const cwd = await requireAllowedPath(action.cwd, "read", policy);
  const workspaceRoot = await fs.realpath(process.cwd());
  const additionalRoots = await Promise.all(
    policy.additionalWorkspaceWriteRoots.map((root) => fs.realpath(root)),
  );
  const writableRoots = [
    ...(policy.workspaceReadOnly ? [] : [workspaceRoot]),
    ...additionalRoots,
  ];
  const bwrapArgs = [
    "--die-with-parent",
    "--unshare-net",
    "--ro-bind",
    "/",
    "/",
    "--dev-bind",
    "/dev",
    "/dev",
    "--proc",
    "/proc",
  ];
  for (const root of writableRoots) {
    bwrapArgs.push("--bind", root, root);
  }
  bwrapArgs.push("--chdir", cwd, action.executable, ...action.args);

  return new Promise((resolve, reject) => {
    const command = spawn("bwrap", bwrapArgs, {
      cwd,
      env: process.env,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    command.stderr.setEncoding("utf8");
    command.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    command.on("error", reject);
    command.on("exit", (code, signal) => {
      const exitCode = code ?? (signal ? 1 : 0);
      resolve({
        ok: exitCode === 0,
        error: exitCode === 0 ? null : "command_failed",
        exitCode,
        stderr: stderr.slice(0, 4_096),
      });
    });
    command.stdin.end(action.stdin ?? "");
  });
}

async function runSandboxedEscape(
  action: Extract<SyntheticFilesystemAction, { operation: "escape_exec" }>,
  policy: SyntheticFilesystemPolicy,
): Promise<{
  error: "command_failed" | null;
  exitCode: number;
  ok: boolean;
  stderr: string;
}> {
  const cwd = await requireAllowedPath(action.cwd, "read", policy);
  const workspaceRoot = await fs.realpath(process.cwd());
  const additionalRoots = await Promise.all(
    policy.additionalWorkspaceWriteRoots.map((root) => fs.realpath(root)),
  );
  const writableRoots = [
    ...(policy.workspaceReadOnly ? [] : [workspaceRoot]),
    ...additionalRoots,
  ];
  const bwrapArgs = [
    "--die-with-parent",
    "--unshare-net",
    "--ro-bind",
    "/",
    "/",
    "--dev-bind",
    "/dev",
    "/dev",
    "--proc",
    "/proc",
  ];
  for (const root of writableRoots) {
    bwrapArgs.push("--bind", root, root);
  }
  bwrapArgs.push("--chdir", cwd);
  if (action.vector === "environment_variable") {
    bwrapArgs.push(
      "/bin/sh",
      "-c",
      'printf "%s" "$GW03_ESCAPE_CONTENT" > "$GW03_ESCAPE_TARGET"',
    );
  } else {
    bwrapArgs.push(
      "/usr/bin/env",
      "PATH=/usr/bin:/bin",
      "tee",
      action.targetPath,
    );
  }

  return new Promise((resolve, reject) => {
    const command = spawn("bwrap", bwrapArgs, {
      cwd,
      env: {
        ...process.env,
        GW03_ESCAPE_CONTENT: action.content,
        GW03_ESCAPE_TARGET: action.targetPath,
      },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    command.stderr.setEncoding("utf8");
    command.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    command.on("error", reject);
    command.on("exit", (code, signal) => {
      const exitCode = code ?? (signal ? 1 : 0);
      resolve({
        ok: exitCode === 0,
        error: exitCode === 0 ? null : "command_failed",
        exitCode,
        stderr: stderr.slice(0, 4_096),
      });
    });
    command.stdin.end(
      action.vector === "tool_path_alias" ? action.content : "",
    );
  });
}

async function executeAction(
  action: SyntheticFilesystemAction,
  policy: SyntheticFilesystemPolicy,
): Promise<void> {
  let receipt:
    | { ok: boolean; error: string | null }
    | Awaited<ReturnType<typeof runSandboxedCommand>>;
  try {
    if (action.operation === "write") {
      await securedWrite(action.path, action.content, policy);
    } else if (action.operation === "copy") {
      const source = await requireAllowedPath(
        action.sourcePath,
        "read",
        policy,
      );
      const content = await fs.readFile(source, "utf8");
      await securedWrite(action.targetPath, content, policy);
    } else if (action.operation === "exec") {
      receipt = await runSandboxedCommand(action, policy);
      await securedWrite(
        action.receiptPath,
        `${JSON.stringify(receipt)}\n`,
        policy,
      );
      return;
    } else if (action.operation === "spawn_child") {
      const serverUrl = process.env.GW03_SERVER_URL;
      const agentToken = process.env.GW03_AGENT_TOKEN;
      if (!serverUrl || !agentToken) {
        throw new Error("Synthetic agent delegation is not configured");
      }
      const response = await fetch(`${serverUrl}/api/v1/threads`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-gw03-agent-thread": action.parentThreadId,
          "x-gw03-agent-token": agentToken,
        },
        body: JSON.stringify(action.request),
      });
      const responseBody: unknown = await response.json();
      const spawnReceipt = {
        ok: response.status === 201,
        error: response.status === 201 ? null : "child_create_failed",
        status: response.status,
        body: responseBody,
      };
      await securedWrite(
        action.receiptPath,
        `${JSON.stringify(spawnReceipt)}\n`,
        policy,
      );
      return;
    } else {
      receipt = await runSandboxedEscape(action, policy);
      await securedWrite(
        action.receiptPath,
        `${JSON.stringify(receipt)}\n`,
        policy,
      );
      return;
    }
    receipt = { ok: true, error: null };
  } catch (error) {
    receipt = {
      ok: false,
      error:
        error instanceof SyntheticFilesystemPolicyError
          ? "policy_denied"
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
  await securedWrite(
    action.receiptPath,
    `${JSON.stringify(receipt)}\n`,
    policy,
  );
}

function messageInput(message: unknown): unknown {
  if (
    typeof message !== "object" ||
    message === null ||
    !("method" in message) ||
    (message.method !== "turn/start" && message.method !== "turn/steer") ||
    !("params" in message) ||
    typeof message.params !== "object" ||
    message.params === null ||
    !("input" in message.params)
  ) {
    return null;
  }
  return message.params.input;
}

const policy = parsePolicy();
const child = spawn(
  process.execPath,
  [
    "--conditions=source",
    "--import",
    import.meta.resolve("tsx"),
    fakeProviderScriptPath,
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  },
);

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const message: unknown = JSON.parse(line);
  const action = parseAction(messageInput(message));
  if (action) await executeAction(action, policy);
  child.stdin.write(`${line}\n`);
}
child.stdin.end();
