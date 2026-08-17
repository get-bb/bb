/**
 * ACP session/model-list parameter mapping: an agent profile plus the
 * canonical execution options in, the bridge's session-construction and
 * model-list params out.
 */

import {
  type DynamicTool,
  type PermissionEscalation,
  type PermissionMode,
  type ReasoningLevel,
  type ServiceTier,
} from "@get-bb/plugin-sdk/provider-bridge";
import path from "node:path";

import { ACP_DEFAULT_MODEL_ID } from "./bridge-protocol.js";
import type {
  AcpAgentNativeReasoning,
  AcpAgentPermissionCli,
  AcpAgentProfile,
  AcpAgentReasoningCli,
} from "./profiles.js";

/**
 * The execution-option subset the ACP session mapping reads. Structurally
 * satisfied by the canonical wire options (`bridgeExecutionOptionsSchema`
 * output).
 */
export interface AcpSessionExecutionOptions {
  model?: string | undefined;
  serviceTier?: ServiceTier | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
  permissionMode: PermissionMode;
  permissionEscalation: PermissionEscalation | null;
  skillRoots?: readonly AcpSkillRoot[] | undefined;
}

/**
 * A staged skill root in ACP's native form. ACP agents have no skill-directory
 * concept, so each root's skills are named inline in the session instructions;
 * the bridge maps the canonical `skills/configure` payload onto this.
 */
export interface AcpSkillRoot {
  id: string;
  skillDirectoryRootPath: string;
  skills: readonly { name: string; description: string }[];
}

export interface AcpAgentCommandParam {
  command: string;
  args: string[];
  cwd?: string;
  envVars?: Record<string, string>;
}

/** What the bridge needs to discover an agent's models. */
export interface AcpModelListParams {
  /**
   * Command whose stdout lists one `id - Display Name` line per model. The
   * bridge groups the ids into model families with reasoning-effort variants
   * (see `bridge/model-catalog.ts`), falling back to the synthetic "Agent
   * default" entry when the command fails or lists nothing. Absent when the
   * profile has no list command — or when there is no profile at all, as in
   * the packaged-bridge smoke, which still gets a valid synthetic response.
   */
  listCommand?: AcpAgentCommandParam;
  /**
   * ACP-native model discovery command. Used only when `listCommand` is
   * absent: the bridge starts a throwaway session and reads the model select
   * from the `session/new` result's config state.
   */
  agent?: AcpAgentCommandParam;
  /**
   * Family ids served in the picker's default list; the rest become
   * selected-only "more models". No matches (or an empty list) serves
   * everything as primary.
   */
  primaryModels: string[];
  reasoningCli?: AcpAgentReasoningCli;
  nativeReasoning?: AcpAgentNativeReasoning;
}

/**
 * Session-level model pin. CLI-style agents resolve (model, reasoningLevel,
 * serviceTier) to a raw model id and launch with `<selectFlag> <resolved-id>`.
 * ACP-native agents receive `{ modelId }` after `session/new` — via their
 * "model"-category config option (`session/set_config_option`) when they
 * advertise one, otherwise via `session/set_model`; if they expose a
 * `thought_level` config option, the bridge applies `reasoningLevel` via
 * `session/set_config_option`. Absent when the thread has no model preference.
 */
export type AcpModelSelection =
  | {
      listCommand: AcpAgentCommandParam;
      selectFlag: string;
      model: string;
      reasoningLevel?: ReasoningLevel;
      serviceTier?: ServiceTier;
    }
  | { modelId: string; reasoningLevel?: ReasoningLevel };

/** Everything the bridge needs to construct one ACP agent session. */
export interface AcpSessionParams {
  threadId: string;
  cwd: string;
  agent: { command: string; args: string[] };
  modelSelection?: AcpModelSelection;
  /**
   * Launch-time reasoning level for agents that take reasoning as a global CLI
   * flag rather than an ACP `thought_level` config option.
   */
  launchReasoningLevel?: ReasoningLevel;
  reasoningCli?: AcpAgentReasoningCli;
  nativeReasoning?: AcpAgentNativeReasoning;
  /**
   * Launch-time permission flags for agents whose own prompt policy must be
   * selected by CLI args rather than by ACP permission responses.
   */
  permissionCli?: AcpAgentPermissionCli;
  permissionMode: "accept-edits" | "full";
  permissionEscalation: PermissionEscalation | null;
  /** Roots (workspace plus configured extras) where client fs writes are allowed. */
  workspaceWriteRoots: string[];
  envVars?: Record<string, string>;
  /** Server-owned instructions; prepended to the session's first prompt. */
  instructions?: string;
  dynamicTools?: readonly DynamicTool[];
}

function sanitizeAcpSkillDescription(description: string): string {
  const sanitized = description
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/[<>]/gu, "")
    .trim();
  return sanitized.length > 0 ? sanitized : "(description unavailable)";
}

function buildAcpSkillsInstructions(
  skillRoots: readonly AcpSkillRoot[] | undefined,
): string | undefined {
  if (!skillRoots || skillRoots.length === 0) {
    return undefined;
  }

  const skillLines = skillRoots.flatMap((skillRoot) => {
    return skillRoot.skills.map((skill) => {
      const skillFilePath = path.join(
        skillRoot.skillDirectoryRootPath,
        skill.name,
        "SKILL.md",
      );
      return `- ${skill.name}: ${sanitizeAcpSkillDescription(skill.description)} (SKILL.md: ${skillFilePath})`;
    });
  });
  if (skillLines.length === 0) {
    return undefined;
  }

  return [
    "bb skills are reusable instruction folders. When the current task matches a listed skill description, read that skill's SKILL.md at the absolute path before proceeding; you may read supporting files in the same skill directory that SKILL.md references. If a listed path does not exist, the list is stale and should be ignored.",
    "",
    "Available bb skills:",
    ...skillLines,
  ].join("\n");
}

function buildAcpSessionInstructions(
  options: AcpSessionExecutionOptions,
): string | undefined {
  const baseInstructions = options.instructions?.trim();
  const skillsInstructions = buildAcpSkillsInstructions(options.skillRoots);
  const instructions = [baseInstructions, skillsInstructions].filter(
    (value): value is string => value !== undefined && value.length > 0,
  );
  return instructions.length > 0 ? instructions.join("\n\n") : undefined;
}

function buildAcpModelListCommand(
  profile: AcpAgentProfile,
): AcpAgentCommandParam | undefined {
  if (!profile.modelCli || profile.modelCli.listArgs.length === 0) {
    return undefined;
  }
  return {
    command: profile.agentCommand.command,
    args: [...profile.modelCli.listArgs],
    ...(profile.cwd !== undefined ? { cwd: profile.cwd } : {}),
    ...(profile.env !== undefined ? { envVars: profile.env } : {}),
  };
}

function buildAcpModelDiscoveryAgentCommand(
  profile: AcpAgentProfile,
): AcpAgentCommandParam | undefined {
  if (buildAcpModelListCommand(profile) !== undefined) {
    return undefined;
  }
  return {
    command: profile.agentCommand.command,
    args: [...profile.agentCommand.args],
    ...(profile.cwd !== undefined ? { cwd: profile.cwd } : {}),
    ...(profile.env !== undefined ? { envVars: profile.env } : {}),
  };
}

/**
 * Model-discovery params derived from the profile. A null profile means the
 * request carried no launch spec; the bridge then serves its synthetic
 * default entry rather than failing the picker.
 */
export function buildAcpModelListParams(
  profile: AcpAgentProfile | null,
): AcpModelListParams {
  if (profile === null) {
    return { primaryModels: [] };
  }
  const listCommand = buildAcpModelListCommand(profile);
  const agent = buildAcpModelDiscoveryAgentCommand(profile);
  return {
    ...(listCommand !== undefined ? { listCommand } : {}),
    ...(agent !== undefined ? { agent } : {}),
    primaryModels: [...(profile.modelCli?.primaryModels ?? [])],
    ...(profile.reasoningCli !== undefined
      ? { reasoningCli: profile.reasoningCli }
      : {}),
    ...(profile.nativeReasoning !== undefined
      ? { nativeReasoning: profile.nativeReasoning }
      : {}),
  };
}

/** The synthetic "acp-default" id is never forwarded. */
function buildAcpModelSelectionParam(
  profile: AcpAgentProfile,
  options: AcpSessionExecutionOptions,
): { modelSelection?: AcpModelSelection } {
  const model = options.model;
  const listCommand = buildAcpModelListCommand(profile);
  if (!model || model === ACP_DEFAULT_MODEL_ID) {
    return {};
  }
  if (!listCommand || !profile.modelCli?.selectFlag) {
    return {
      modelSelection: {
        modelId: model,
        ...(options.reasoningLevel !== undefined
          ? { reasoningLevel: options.reasoningLevel }
          : {}),
      },
    };
  }
  // Cursor encodes reasoning in the selected model id and has no ACP
  // `thought_level` option; keep that CLI variant path separate from native
  // ACP config-option reasoning.
  return {
    modelSelection: {
      listCommand,
      selectFlag: profile.modelCli.selectFlag,
      model,
      ...(options.reasoningLevel !== undefined
        ? { reasoningLevel: options.reasoningLevel }
        : {}),
      // Only "fast" changes resolution; "default" is the catalog's normal id.
      ...(options.serviceTier === "fast"
        ? { serviceTier: options.serviceTier }
        : {}),
    },
  };
}

export interface BuildAcpSessionParamsArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  cwd: string;
  dynamicTools?: readonly DynamicTool[] | undefined;
  options: AcpSessionExecutionOptions;
  profile: AcpAgentProfile;
  /** Provider label used in user-facing capability errors. */
  providerLabel: string;
  threadId: string;
}

/** The bridge's session-construction params for a thread start/resume/fork. */
export function buildAcpSessionParams(
  args: BuildAcpSessionParamsArgs,
): AcpSessionParams {
  const { options, profile } = args;
  const instructions = buildAcpSessionInstructions(options);
  const cwd = profile.cwd ?? args.cwd;
  const envVars = {
    ...(profile.env ?? {}),
    ...(options.envVars ?? {}),
  };
  if (options.permissionMode === "auto") {
    throw new Error(
      `Provider "${args.providerLabel}" does not support permission mode "auto".`,
    );
  }
  return {
    threadId: args.threadId,
    cwd,
    agent: {
      command: profile.agentCommand.command,
      args: [...profile.agentCommand.args],
    },
    ...buildAcpModelSelectionParam(profile, options),
    ...(profile.reasoningCli !== undefined
      ? { reasoningCli: profile.reasoningCli }
      : {}),
    ...(profile.nativeReasoning !== undefined
      ? { nativeReasoning: profile.nativeReasoning }
      : {}),
    ...(profile.permissionCli !== undefined
      ? { permissionCli: profile.permissionCli }
      : {}),
    ...(profile.reasoningCli !== undefined &&
    options.reasoningLevel !== undefined
      ? { launchReasoningLevel: options.reasoningLevel }
      : {}),
    permissionMode: options.permissionMode,
    permissionEscalation: options.permissionEscalation,
    workspaceWriteRoots: [cwd, ...args.additionalWorkspaceWriteRoots],
    ...(Object.keys(envVars).length > 0 ? { envVars } : {}),
    ...(instructions ? { instructions } : {}),
    ...(args.dynamicTools && args.dynamicTools.length > 0
      ? { dynamicTools: args.dynamicTools }
      : {}),
  };
}
