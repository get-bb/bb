import {
  normalizeProviderNativeRoots,
  providerNativeRootsAreEmpty,
  type ProviderNativeRoots,
} from "@bb/domain";
import type { DiscoveredSkill } from "@bb/host-daemon-contract";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { hostPathDirname } from "../lib/host-path.js";
import { listNativeRootSkills } from "../providers/native-roots.js";
import type { SharedInjectedSkillSource } from "./injected-skills.js";
import type { SkillRegistration } from "./skill-listing.js";

export interface ResolvedSharedSkills {
  runtimeSources: SharedInjectedSkillSource[];
  summaries: SkillRegistration[];
  identities: ReadonlyMap<string, { contentSha256: string; realPath: string }>;
}

function toSharedSkill(
  deps: Pick<LoggedWorkSessionDeps, "logger">,
  skill: DiscoveredSkill,
): {
  runtimeSource: SharedInjectedSkillSource;
  summary: SkillRegistration;
} | null {
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
    return { runtimeSources: [], summaries: [], identities: new Map() };
  }
  const result = await listNativeRootSkills(deps, {
    registrations: [],
    sharedRoots: roots,
    hostId: args.hostId,
    cwd: args.cwd,
  });
  return toResolvedSharedSkills(deps, result.sharedSkills);
}

export function toResolvedSharedSkills(
  deps: Pick<LoggedWorkSessionDeps, "logger">,
  skills: readonly DiscoveredSkill[],
): ResolvedSharedSkills {
  const resolved: Array<NonNullable<ReturnType<typeof toSharedSkill>>> = [];
  const summaries: SkillRegistration[] = [];
  const names = new Set<string>();
  for (const skill of skills) {
    const entry = toSharedSkill(deps, skill);
    if (entry === null) continue;
    summaries.push(entry.summary);
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
    identities: new Map(
      skills.map((skill) => [
        skill.id,
        { contentSha256: skill.contentSha256, realPath: skill.realPath },
      ]),
    ),
    runtimeSources: resolved.map((entry) => entry.runtimeSource),
    summaries,
  };
}
