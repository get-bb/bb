import {
  type InstructionMode,
  type PermissionEscalation,
  type ReasoningLevel,
  type RuntimePermissionScope,
} from "@get-bb/plugin-sdk/provider-bridge";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Options, Settings } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudePermissionMode } from "../interactive-contract.js";
import { buildReadonlyBashUpdatedInput } from "./readonly-bash-policy.js";
import type {
  ClaudeMutableFlagSettings,
  ClaudeSdkReasoningEffort,
  SdkSessionOptions,
} from "./sdk-session.js";

export interface BuildSessionOptionsArgs {
  additionalWorkspaceWriteRoots?: readonly string[];
  baseInstructions?: string;
  cwd: string;
  disallowedTools?: readonly string[];
  instructionMode: InstructionMode;
  model?: string;
  getPermissionEscalation: (
    context: PermissionEscalationWorkContext,
  ) => PermissionEscalation | null;
  permissionMode: ClaudePermissionMode;
  permissionScope: RuntimePermissionScope;
  plugins?: Options["plugins"];
  reasoningLevel?: ReasoningLevel;
  workflowsEnabled: boolean;
  chromeEnabled: boolean;
  memoryEnabled?: boolean;
}

export interface PermissionEscalationWorkContext {
  agentId?: string;
  promptId?: string;
  toolUseId?: string;
}

interface ResolveExecutableOnPathArgs {
  executableName: string;
  pathEnv: string | undefined;
  platform?: NodeJS.Platform;
  pathExtEnv?: string | undefined;
}

interface ResolveClaudeCodeExecutableArgs {
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

const READONLY_ALLOWED_TOOLS = new Set([
  "Agent",
  "Glob",
  "Grep",
  "LS",
  "Read",
  "TodoRead",
]);
const READONLY_BASH_TOOL_NAME = "Bash";
const READONLY_ASK_REASON =
  "bb readonly mode requires approval before using tools that can modify state, run commands, access network, or perform non-read actions.";
const SUMMARIZED_ADAPTIVE_THINKING = {
  type: "adaptive",
  display: "summarized",
} satisfies Exclude<Options["thinking"], undefined>;
const CLAUDE_CODE_EXECUTABLE_ENV = "BB_CLAUDE_CODE_EXECUTABLE";

export function toSdkEffort(
  reasoningLevel: ReasoningLevel,
): ClaudeSdkReasoningEffort {
  if (reasoningLevel === "ultracode") return "xhigh";
  if (reasoningLevel === "none") return "low";
  if (reasoningLevel === "ultra") return "max";
  return reasoningLevel;
}

function buildFlagSettings(params: BuildSessionOptionsArgs): Settings {
  return {
    autoMemoryEnabled: params.memoryEnabled ?? true,
    enableWorkflows: params.workflowsEnabled,
    ultracode: params.reasoningLevel === "ultracode",
  };
}

export function buildChromeExtraArgs(
  chromeEnabled: boolean,
): Options["extraArgs"] | undefined {
  return chromeEnabled ? { chrome: null } : undefined;
}

export function buildMutableFlagSettings(args: {
  memoryEnabled: boolean;
  reasoningLevel: ReasoningLevel | undefined;
  workflowsEnabled: boolean;
}): ClaudeMutableFlagSettings {
  return {
    autoMemoryEnabled: args.memoryEnabled,
    enableWorkflows: args.workflowsEnabled,
    ...(args.reasoningLevel !== undefined
      ? { effortLevel: toSdkEffort(args.reasoningLevel) }
      : {}),
    ultracode: args.reasoningLevel === "ultracode",
  };
}

export function buildReadonlyDenialMessage(): string {
  return "bb readonly mode allows reading and analysis only. Continue with a read-only answer; do not modify files, run mutating shell commands, use network, or use mutating tools.";
}

export function buildWorkspaceWriteDenialMessage(): string {
  return "bb's workspace sandbox allows work inside the current workspace only. Stay inside the workspace or explain why extra access is needed.";
}

function buildReadonlyHooks(
  params: BuildSessionOptionsArgs,
): Options["hooks"] | undefined {
  if (
    params.permissionMode !== "default" &&
    params.permissionMode !== "dontAsk"
  ) {
    return undefined;
  }

  const getPermissionEscalation = params.getPermissionEscalation;

  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            if (
              input.hook_event_name !== "PreToolUse" ||
              READONLY_ALLOWED_TOOLS.has(input.tool_name)
            ) {
              return { continue: true };
            }
            if (input.tool_name === READONLY_BASH_TOOL_NAME) {
              const updatedInput = buildReadonlyBashUpdatedInput(
                input.tool_input,
              );
              if (updatedInput) {
                return {
                  continue: true,
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "allow",
                    updatedInput,
                  },
                };
              }
            }

            const permissionDecision =
              getPermissionEscalation({
                ...(input.agent_id !== undefined
                  ? { agentId: input.agent_id }
                  : {}),
                ...(input.prompt_id !== undefined
                  ? { promptId: input.prompt_id }
                  : {}),
                toolUseId: input.tool_use_id,
              }) === "deny"
                ? "deny"
                : "ask";
            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision,
                permissionDecisionReason:
                  permissionDecision === "deny"
                    ? buildReadonlyDenialMessage()
                    : READONLY_ASK_REASON,
              },
            };
          },
        ],
      },
    ],
  };
}

function usesWorkspaceSandbox(params: BuildSessionOptionsArgs): boolean {
  return (
    params.permissionScope === "workspace" &&
    (params.permissionMode === "acceptEdits" ||
      params.permissionMode === "auto")
  );
}

function buildWorkspaceWriteSandbox(
  params: BuildSessionOptionsArgs,
): Options["sandbox"] | undefined {
  if (!usesWorkspaceSandbox(params)) {
    return undefined;
  }

  const allowWrite = params.additionalWorkspaceWriteRoots ?? [];
  return {
    enabled: true,
    failIfUnavailable: false,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: true,
    network: { allowLocalBinding: true },
    ...(allowWrite.length > 0
      ? { filesystem: { allowWrite: [...allowWrite] } }
      : {}),
  };
}

function isExecutableFile(candidatePath: string): boolean {
  try {
    accessSync(candidatePath, constants.X_OK);
    return statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function windowsExecutableExtensions(
  pathExtEnv: string | undefined,
): string[] {
  const raw = pathExtEnv ?? ".COM;.EXE;.BAT;.CMD;.PS1";
  const extensions = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
  return extensions.length > 0 ? extensions : [".COM", ".EXE", ".BAT", ".CMD", ".PS1"];
}

function resolveExplicitWindowsExecutable(candidate: string): string | null {
  if (/\.(?:com|exe|bat|cmd|ps1)$/iu.test(candidate)) {
    return isExecutableFile(candidate) ? candidate : null;
  }
  const extensions = windowsExecutableExtensions(process.env.PATHEXT);
  for (const extension of extensions) {
    const sibling = `${candidate}${extension}`;
    if (isExecutableFile(sibling)) {
      return sibling;
    }
  }
  return isExecutableFile(candidate) ? candidate : null;
}

function resolveExecutableOnPath(
  args: ResolveExecutableOnPathArgs,
): string | null {
  if (!args.pathEnv) {
    return null;
  }
  const platform = args.platform ?? process.platform;
  if (platform !== "win32") {
    for (const searchDir of args.pathEnv.split(delimiter)) {
      if (!searchDir) {
        continue;
      }
      const candidate = join(searchDir, args.executableName);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
    return null;
  }
  const extensions = windowsExecutableExtensions(args.pathExtEnv ?? process.env.PATHEXT);
  const searchDirs = args.pathEnv.split(delimiter).filter((dir) => dir !== "");
  for (const searchDir of searchDirs) {
    for (const extension of extensions) {
      const candidate = join(searchDir, `${args.executableName}${extension}`);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  for (const searchDir of searchDirs) {
    const candidate = join(searchDir, args.executableName);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

function wellKnownClaudeExecutablePaths(env: NodeJS.ProcessEnv): string[] {
  if (process.getuid?.() === 0) {
    return [];
  }
  const candidatePaths: string[] = [];
  const home = env.HOME?.trim();
  if (home) {
    candidatePaths.push(
      join(home, ".local", "bin", "claude"),
      join(home, ".claude", "local", "claude"),
    );
  }
  candidatePaths.push("/opt/homebrew/bin/claude", "/usr/local/bin/claude");
  return candidatePaths;
}

export function resolveClaudeCodeExecutable(
  args: ResolveClaudeCodeExecutableArgs,
): string | null {
  const platform = args.platform ?? process.platform;
  const explicitPath = args.env[CLAUDE_CODE_EXECUTABLE_ENV];
  const trimmedExplicitPath = explicitPath?.trim();
  if (trimmedExplicitPath && trimmedExplicitPath.length > 0) {
    if (platform === "win32") {
      const resolved = resolveExplicitWindowsExecutable(trimmedExplicitPath);
      if (resolved !== null) {
        return resolved;
      }
      throw new Error(
        `${CLAUDE_CODE_EXECUTABLE_ENV} must point to an executable Claude CLI path: ${trimmedExplicitPath}`,
      );
    }
    try {
      accessSync(trimmedExplicitPath, constants.X_OK);
      return trimmedExplicitPath;
    } catch {
      throw new Error(
        `${CLAUDE_CODE_EXECUTABLE_ENV} must point to an executable Claude CLI path: ${trimmedExplicitPath}`,
      );
    }
  }

  const executableOnPath = resolveExecutableOnPath({
    executableName: "claude",
    pathEnv: args.env.PATH,
    platform,
    pathExtEnv: args.env.PATHEXT,
  });
  if (executableOnPath) {
    return executableOnPath;
  }

  for (const candidate of wellKnownClaudeExecutablePaths(args.env)) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function buildSessionOptions(
  params: BuildSessionOptionsArgs,
  env: NodeJS.ProcessEnv,
): SdkSessionOptions {
  const systemPrompt: Exclude<Options["systemPrompt"], undefined> =
    params.instructionMode === "replace"
      ? (params.baseInstructions ?? "You are a helpful coding assistant.")
      : {
          type: "preset",
          preset: "claude_code",
          ...(params.baseInstructions && params.baseInstructions.length > 0
            ? { append: params.baseInstructions }
            : {}),
        };
  const model = params.model;
  const sandbox = buildWorkspaceWriteSandbox(params);
  const hooks = buildReadonlyHooks(params);
  const additionalDirectories = usesWorkspaceSandbox(params)
    ? (params.additionalWorkspaceWriteRoots ?? [])
    : [];
  const pathToClaudeCodeExecutable = resolveClaudeCodeExecutable({ env });
  const flagSettings = buildFlagSettings(params);
  const extraArgs = buildChromeExtraArgs(params.chromeEnabled);

  return {
    cwd: params.cwd,
    systemPrompt,
    model,
    env,
    permissionMode: params.permissionMode,
    ...(params.reasoningLevel
      ? { effort: toSdkEffort(params.reasoningLevel) }
      : {}),
    ...(params.reasoningLevel
      ? { thinking: SUMMARIZED_ADAPTIVE_THINKING }
      : {}),
    settings: flagSettings,
    ...(extraArgs ? { extraArgs } : {}),
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
    ...(params.plugins ? { plugins: params.plugins } : {}),
    ...(sandbox ? { sandbox } : {}),
    ...(hooks ? { hooks } : {}),
    ...(additionalDirectories.length > 0
      ? { additionalDirectories: [...additionalDirectories] }
      : {}),
    ...(params.disallowedTools && params.disallowedTools.length > 0
      ? { disallowedTools: [...params.disallowedTools] }
      : {}),
  };
}
