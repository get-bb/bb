import type { PromptInput } from "@bb/domain";
import type { DiscoveredSkill } from "@bb/host-daemon-contract";
import type { LoggedWorkSessionDeps } from "../../types.js";
import {
  providerHasNativeRootSurface,
  scanProviderNativeRoots,
} from "../providers/native-roots.js";

interface SkillMentionContextArgs {
  hostId: string;
  input: readonly PromptInput[];
  providerId: string;
  workspacePath: string;
}

function collectSkillMentionNames(input: readonly PromptInput[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of input) {
    if (item.type !== "text") continue;
    for (const mention of item.mentions) {
      const resource = mention.resource;
      if (resource.kind !== "command" || resource.source !== "skill") continue;
      if (seen.has(resource.name)) continue;
      seen.add(resource.name);
      names.push(resource.name);
    }
  }
  return names;
}

function skillContextInput(name: string, filePath: string | null): PromptInput {
  return {
    type: "text",
    text:
      filePath === null
        ? `Context for /${name} (not resolved by bb): run \`bb skill list\` to find this skill's SKILL.md before continuing; do not search the filesystem for it.`
        : `Context for /${name} (resolved by bb): read ${filePath} before continuing; the skill's supporting files live beside it.`,
    mentions: [],
    visibility: "agent-only",
  };
}

export async function resolveSkillMentionContextInputs(
  deps: LoggedWorkSessionDeps,
  args: SkillMentionContextArgs,
): Promise<PromptInput[]> {
  const names = collectSkillMentionNames(args.input);
  if (names.length === 0) {
    return [];
  }
  const registration = deps.providerRegistry.get(args.providerId);
  if (registration === null || !providerHasNativeRootSurface(registration)) {
    return names.map((name) => skillContextInput(name, null));
  }
  let skills: readonly DiscoveredSkill[];
  try {
    const result = await scanProviderNativeRoots(deps, {
      type: "host.list_skills",
      registration,
      hostId: args.hostId,
      cwd: args.workspacePath,
    });
    skills = result.skills;
  } catch (error) {
    deps.logger.warn(
      { err: error, hostId: args.hostId, providerId: args.providerId },
      "Could not resolve native skill mention paths",
    );
    return names.map((name) => skillContextInput(name, null));
  }
  return names.map((name) => {
    const skill = skills.find((candidate) => candidate.name === name);
    return skillContextInput(name, skill?.filePath ?? null);
  });
}
