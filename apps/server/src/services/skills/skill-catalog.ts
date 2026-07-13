import type { HostDaemonInjectedSkillSource } from "@bb/host-daemon-contract";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { getPluginSkillsRootPaths } from "../plugins/plugin-agent-contributions.js";
import { generatedSkillsRootPath } from "../plugins/plugin-commands-skill.js";
import {
  resolveInjectedSkillSources,
  type ProjectInjectedSkillSource,
} from "./injected-skills.js";

interface ResolveSkillCatalogSourcesArgs {
  projectSkillSources?: readonly ProjectInjectedSkillSource[];
}

/**
 * Resolve the server-owned skill catalog shared by runtime injection and
 * slash-command discovery. Project sources are supplied by callers that have
 * a concrete workspace; global, plugin, and built-in tiers are always present.
 */
export function resolveSkillCatalogSources(
  deps: Pick<LoggedWorkSessionDeps, "config" | "logger" | "skillTreeRegistry">,
  args: ResolveSkillCatalogSourcesArgs = {},
): HostDaemonInjectedSkillSource[] {
  return resolveInjectedSkillSources(deps.logger, {
    additionalSkillsRootPaths: [
      ...deps.config.inheritedSkillsRootPaths,
      generatedSkillsRootPath(deps.config.dataDir),
    ],
    builtinSkillsRootPath: deps.config.builtinSkillsRootPath,
    dataDir: deps.config.dataDir,
    pluginSkillsRootPaths: getPluginSkillsRootPaths(),
    ...(args.projectSkillSources !== undefined
      ? { projectSkillSources: args.projectSkillSources }
      : {}),
    skillTreeRegistry: deps.skillTreeRegistry,
  });
}
