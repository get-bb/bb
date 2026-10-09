import path from "node:path";
import {
  EMPTY_PROVIDER_NATIVE_ROOTS,
  EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS,
  normalizeProviderNativeRoots,
  providerNativeRootsAreEmpty,
  type ProviderNativeRoots,
} from "@bb/domain";
import type { DiscoveredSkill } from "@bb/host-daemon-contract";
import type { SkillSummary } from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import type { SharedInjectedSkillSource } from "./injected-skills.js";

export interface ResolvedSharedSkills {
  runtimeSources: SharedInjectedSkillSource[];
  summaries: SkillSummary[];
}

export function hostPathDirname(filePath: string): string {
  return /^[a-zA-Z]:[\\/]/u.test(filePath)
    ? path.win32.dirname(filePath)
    : path.posix.dirname(filePath);
}

function toSharedSkill(
  deps: Pick<LoggedWorkSessionDeps, "logger">,
  skill: DiscoveredSkill,
): { runtimeSource: SharedInjectedSkillSource; summary: SkillSummary } | null {
  const sourceType = skill.rootKind;
  if (sourceType !== "shared-user" && sourceType !== "shared-project") {
    return null;
  }
  if (skill.description === null) {
    deps.logger.warn(
      {
        filePath: skill.filePath,
        name: skill.name,
        reason: "Shared skill description is missing",
      },
      "Skipping invalid shared skill",
    );
    return null;
  }
  return {
    runtimeSource: {
      kind: "host-path",
      sourceType,
      name: skill.name,
      description: skill.description,
      sourceRootPath: hostPathDirname(skill.filePath),
      skillFilePath: skill.filePath,
    },
    summary: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      provider: null,
      scope: sourceType,
      pluginId: null,
      filePath: skill.filePath,
      manageable: false,
      registrySkillId: null,
    },
  };
}

export function sharedSkillNativeRoots(
  deps: Pick<LoggedWorkSessionDeps, "config">,
): ProviderNativeRoots {
  return normalizeProviderNativeRoots(deps.config.sharedSkillRoots);
}

export async function resolveSharedSkills(
  deps: LoggedWorkSessionDeps,
  args: { hostId: string; cwd: string | null },
): Promise<ResolvedSharedSkills> {
  const roots = sharedSkillNativeRoots(deps);
  if (providerNativeRootsAreEmpty(roots)) {
    return { runtimeSources: [], summaries: [] };
  }
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.list_skills",
      providerId: "bb-shared",
      cwd: args.cwd,
      nativeRoots: {
        skills: roots,
        commands: EMPTY_PROVIDER_NATIVE_ROOTS,
        resolved: EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS,
      },
    },
  });
  return toResolvedSharedSkills(deps, result.skills);
}

export function toResolvedSharedSkills(
  deps: Pick<LoggedWorkSessionDeps, "logger">,
  skills: readonly DiscoveredSkill[],
): ResolvedSharedSkills {
  const resolved: Array<NonNullable<ReturnType<typeof toSharedSkill>>> = [];
  const names = new Set<string>();
  for (const skill of skills) {
    const entry = toSharedSkill(deps, skill);
    if (entry === null) continue;
    if (names.has(entry.runtimeSource.name)) {
      deps.logger.debug(
        {
          filePath: entry.summary.filePath,
          name: entry.runtimeSource.name,
        },
        "Lower-priority shared skill overridden by an earlier root",
      );
      continue;
    }
    names.add(entry.runtimeSource.name);
    resolved.push(entry);
  }
  return {
    runtimeSources: resolved.map((entry) => entry.runtimeSource),
    summaries: resolved.map((entry) => entry.summary),
  };
}
