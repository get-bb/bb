import type { LoggedWorkSessionDeps } from "../../types.js";
import { getPluginSkillRootContributions } from "../plugins/plugin-agent-contributions.js";
import { generatedSkillsRootPath } from "../plugins/plugin-commands-skill.js";
import {
  resolveSkillCatalogEntries,
  type ResolveInjectedSkillSourcesArgs,
  type ProjectInjectedSkillSource,
  type ResolvedSkillCatalogEntry,
  type SharedInjectedSkillSource,
} from "./injected-skills.js";

interface ResolveSkillCatalogSourcesArgs {
  pluginSkillSelections?: ReadonlyMap<string, ReadonlySet<string>>;
  projectSkillSources?: readonly ProjectInjectedSkillSource[];
  sharedSkillSources?: readonly SharedInjectedSkillSource[];
}

export function resolveSkillCatalog(
  deps: Pick<LoggedWorkSessionDeps, "config" | "logger" | "skillTreeRegistry">,
  args: ResolveSkillCatalogSourcesArgs = {},
): ResolvedSkillCatalogEntry[] {
  const catalogArgs: ResolveInjectedSkillSourcesArgs = {
    additionalSkillsRootPaths: [
      ...deps.config.inheritedSkillsRootPaths,
      generatedSkillsRootPath(deps.config.dataDir),
    ],
    builtinSkillsRootPath: deps.config.builtinSkillsRootPath,
    dataDir: deps.config.dataDir,
    pluginSkillRoots: getPluginSkillRootContributions(),
    skillTreeRegistry: deps.skillTreeRegistry,
  };
  if (args.pluginSkillSelections !== undefined) {
    catalogArgs.pluginSkillSelections = args.pluginSkillSelections;
  }
  if (args.projectSkillSources !== undefined) {
    catalogArgs.projectSkillSources = args.projectSkillSources;
  }
  if (args.sharedSkillSources !== undefined) {
    catalogArgs.sharedSkillSources = args.sharedSkillSources;
  }
  return resolveSkillCatalogEntries(deps.logger, catalogArgs);
}
