import path from "node:path";
import type {
  AgentRuntimeClaudeCodeSkillRoot,
  AgentRuntimeCodexSkillRoot,
  AgentRuntimePiSkillRoot,
  AgentRuntimeSkillRoot,
} from "./types.js";

export interface FilterSkillRootsForProviderArgs {
  providerId: string;
  skillRoots: readonly AgentRuntimeSkillRoot[];
}

export interface NormalizeSkillRootsArgs {
  skillRoots: readonly AgentRuntimeSkillRoot[] | undefined;
}

interface AssertAbsoluteSkillRootPathArgs {
  id: string;
  path: string;
  providerId: AgentRuntimeSkillRoot["providerId"];
  pathField: string;
}

export function normalizeSkillRoots(
  args: NormalizeSkillRootsArgs,
): readonly AgentRuntimeSkillRoot[] {
  if (!args.skillRoots || args.skillRoots.length === 0) {
    return [];
  }

  return args.skillRoots.map((skillRoot) => normalizeSkillRoot(skillRoot));
}

export function filterSkillRootsForProvider(
  args: FilterSkillRootsForProviderArgs,
): readonly AgentRuntimeSkillRoot[] {
  return args.skillRoots.filter(
    (skillRoot) => skillRoot.providerId === args.providerId,
  );
}

function normalizeSkillRoot(
  skillRoot: AgentRuntimeSkillRoot,
): AgentRuntimeSkillRoot {
  switch (skillRoot.providerId) {
    case "claude-code":
      return normalizeClaudeCodeSkillRoot(skillRoot);
    case "codex":
      return normalizeCodexSkillRoot(skillRoot);
    case "pi":
      return normalizePiSkillRoot(skillRoot);
    default:
      return assertKnownSkillRootProvider(skillRoot);
  }
}

function normalizeClaudeCodeSkillRoot(
  skillRoot: AgentRuntimeClaudeCodeSkillRoot,
): AgentRuntimeClaudeCodeSkillRoot {
  assertAbsoluteSkillRootPath({
    id: skillRoot.id,
    path: skillRoot.localPluginPath,
    pathField: "localPluginPath",
    providerId: skillRoot.providerId,
  });

  return {
    id: skillRoot.id,
    providerId: skillRoot.providerId,
    localPluginPath: skillRoot.localPluginPath,
  };
}

function normalizeCodexSkillRoot(
  skillRoot: AgentRuntimeCodexSkillRoot,
): AgentRuntimeCodexSkillRoot {
  assertAbsoluteSkillRootPath({
    id: skillRoot.id,
    path: skillRoot.skillDirectoryRootPath,
    pathField: "skillDirectoryRootPath",
    providerId: skillRoot.providerId,
  });

  return {
    id: skillRoot.id,
    providerId: skillRoot.providerId,
    skillDirectoryRootPath: skillRoot.skillDirectoryRootPath,
  };
}

function normalizePiSkillRoot(
  skillRoot: AgentRuntimePiSkillRoot,
): AgentRuntimePiSkillRoot {
  assertAbsoluteSkillRootPath({
    id: skillRoot.id,
    path: skillRoot.skillDirectoryRootPath,
    pathField: "skillDirectoryRootPath",
    providerId: skillRoot.providerId,
  });

  return {
    id: skillRoot.id,
    providerId: skillRoot.providerId,
    skillDirectoryRootPath: skillRoot.skillDirectoryRootPath,
  };
}

function assertAbsoluteSkillRootPath(args: AssertAbsoluteSkillRootPathArgs) {
  if (path.isAbsolute(args.path)) {
    return;
  }

  throw new Error(
    `Agent runtime ${args.providerId} skill root "${args.id}" must use an absolute ${args.pathField}: ${args.path}`,
  );
}

function assertKnownSkillRootProvider(
  _skillRoot: never,
): AgentRuntimeSkillRoot {
  throw new Error("Unsupported agent runtime skill root provider.");
}
