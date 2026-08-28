import {
  type InstructionMode,
  type PermissionEscalation,
  type ReasoningLevel,
  type RuntimePermissionScope,
  jsonValueSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Options, Settings } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ClaudePermissionMode } from "../interactive-contract.js";
import { buildReadonlyBashUpdatedInput } from "./readonly-bash-policy.js";
import type {
  ClaudeMutableFlagSettings,
  ClaudeSdkReasoningEffort,
  SdkSessionOptions,
} from "./sdk-session.js";

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

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
}

interface ResolveClaudeCodeExecutableArgs {
  env: NodeJS.ProcessEnv;
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

export function buildMutableFlagSettings(args: {
  memoryEnabled: boolean;
  reasoningLevel: ReasoningLevel | undefined;
  workflowsEnabled: boolean;
}): ClaudeMutableFlagSettings {
  const settings: ClaudeMutableFlagSettings = {
    autoMemoryEnabled: args.memoryEnabled,
    enableWorkflows: args.workflowsEnabled,
    ultracode: args.reasoningLevel === "ultracode",
  };
  if (args.reasoningLevel !== undefined) {
    settings.effortLevel = toSdkEffort(args.reasoningLevel);
  }
  return settings;
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
              const toolInput = jsonObjectSchema.safeParse(input.tool_input);
              const updatedInput = toolInput.success
                ? buildReadonlyBashUpdatedInput(toolInput.data)
                : null;
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

            const workContext: PermissionEscalationWorkContext = {
              toolUseId: input.tool_use_id,
            };
            if (input.agent_id !== undefined) {
              workContext.agentId = input.agent_id;
            }
            if (input.prompt_id !== undefined) {
              workContext.promptId = input.prompt_id;
            }
            const permissionDecision =
              getPermissionEscalation(workContext) === "deny" ? "deny" : "ask";
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
  const sandbox: NonNullable<Options["sandbox"]> = {
    enabled: true,
    failIfUnavailable: false,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: true,
    network: { allowLocalBinding: true },
  };
  if (allowWrite.length > 0) {
    sandbox.filesystem = { allowWrite: [...allowWrite] };
  }
  return sandbox;
}

function isExecutableFile(candidatePath: string): boolean {
  try {
    accessSync(candidatePath, constants.X_OK);
    return statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function resolveExecutableOnPath(
  args: ResolveExecutableOnPathArgs,
): string | null {
  if (!args.pathEnv) {
    return null;
  }

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
  const explicitPath = args.env[CLAUDE_CODE_EXECUTABLE_ENV];
  const trimmedExplicitPath = explicitPath?.trim();
  if (trimmedExplicitPath && trimmedExplicitPath.length > 0) {
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
  let systemPrompt: Exclude<Options["systemPrompt"], undefined>;
  if (params.instructionMode === "replace") {
    systemPrompt =
      params.baseInstructions ?? "You are a helpful coding assistant.";
  } else {
    const presetPrompt: Extract<
      Exclude<Options["systemPrompt"], undefined>,
      { type: "preset" }
    > = {
      type: "preset",
      preset: "claude_code",
    };
    if (
      params.baseInstructions !== undefined &&
      params.baseInstructions.length > 0
    ) {
      presetPrompt.append = params.baseInstructions;
    }
    systemPrompt = presetPrompt;
  }
  const model = params.model;
  const sandbox = buildWorkspaceWriteSandbox(params);
  const hooks = buildReadonlyHooks(params);
  const additionalDirectories = usesWorkspaceSandbox(params)
    ? (params.additionalWorkspaceWriteRoots ?? [])
    : [];
  const pathToClaudeCodeExecutable = resolveClaudeCodeExecutable({ env });
  const flagSettings = buildFlagSettings(params);

  const options: SdkSessionOptions = {
    cwd: params.cwd,
    systemPrompt,
    model,
    env,
    permissionMode: params.permissionMode,
    settings: flagSettings,
  };
  if (params.reasoningLevel) {
    options.effort = toSdkEffort(params.reasoningLevel);
    options.thinking = SUMMARIZED_ADAPTIVE_THINKING;
  }
  if (pathToClaudeCodeExecutable) {
    options.pathToClaudeCodeExecutable = pathToClaudeCodeExecutable;
  }
  if (params.plugins) {
    options.plugins = params.plugins;
  }
  if (sandbox) {
    options.sandbox = sandbox;
  }
  if (hooks) {
    options.hooks = hooks;
  }
  if (additionalDirectories.length > 0) {
    options.additionalDirectories = [...additionalDirectories];
  }
  if (params.disallowedTools && params.disallowedTools.length > 0) {
    options.disallowedTools = [...params.disallowedTools];
  }
  return options;
}
