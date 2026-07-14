import {
  buildAcpProviderInfo,
  getBuiltInAgentProviderInfo,
  isAcpProviderId,
  isAgentProviderId,
} from "@bb/agent-providers";
import { getEnvironment, getProjectSourceByHost } from "@bb/db";
import {
  providerCommandSectionRank,
  type CommandListResponse,
  type ProviderCommand,
} from "@bb/server-contract";
import type { HostProviderCommand } from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import { requirePrimaryHostId } from "../hosts/primary-host.js";
import type { ResolvedSkillCatalogEntry } from "../skills/injected-skills.js";

const BUILT_IN_PROVIDER_COMMANDS: ProviderCommand[] = [
  {
    name: "compact",
    source: "command",
    origin: "builtin",
    description: "Compact context",
    argumentHint: null,
  },
];

function providerComposerHasSkillsAction(
  composerActions: readonly { kind: string }[],
): boolean {
  return composerActions.some((action) => action.kind === "skills");
}

/**
 * Whether the provider declares a skills composer action (slash-command
 * typeahead). Built-in providers are looked up in the catalog; dynamic ACP
 * providers (`acp-*`) share the ACP catalog template via `buildAcpProviderInfo`.
 */
export function providerHasCommandSurface(providerId: string): boolean {
  if (isAgentProviderId(providerId)) {
    return providerComposerHasSkillsAction(
      getBuiltInAgentProviderInfo(providerId).composerActions,
    );
  }
  if (isAcpProviderId(providerId)) {
    return providerComposerHasSkillsAction(
      buildAcpProviderInfo({
        id: providerId,
        displayName: providerId,
        logoUrl: null,
      }).composerActions,
    );
  }
  return false;
}

export interface CommandWorkspace {
  hostId: string;
  /**
   * Absolute workspace path for project-origin discovery, or `null` when there
   * is no resolvable workspace yet (new-thread composer, or an unprovisioned
   * environment). `null` is passed through to the daemon, which then scans only
   * the user-home roots.
   */
  cwd: string | null;
}

export interface ResolveCommandWorkspaceArgs {
  environmentId: string | null;
  projectId: string;
}

/**
 * Resolve the `(hostId, cwd)` pair the command-typeahead RPC runs against,
 * degrading gracefully so a pre-environment request still lists user-home
 * entries:
 *   1. the environment path when the environment is `ready`;
 *   2. else the project's local-path source on the primary host;
 *   3. else the primary host with `cwd: null`.
 * Unlike the path-search resolvers (which require a concrete path and throw),
 * command discovery is valid with `cwd: null`, so each step falls through to
 * the next instead of surfacing an error. In particular an environment that is
 * still provisioning or otherwise unavailable must NOT fail here — it
 * degrades to the project source / user-home roots — so this reads the
 * environment with the non-throwing `getEnvironment` rather than
 * `requireReadyEnvironment`.
 */
export function resolveCommandWorkspace(
  deps: Pick<AppDeps, "config" | "db" | "hub">,
  args: ResolveCommandWorkspaceArgs,
): CommandWorkspace {
  if (args.environmentId !== null) {
    const environment = getEnvironment(deps.db, args.environmentId);
    if (
      environment !== null &&
      environment.status === "ready" &&
      environment.path !== null &&
      environment.projectId === args.projectId
    ) {
      return { hostId: environment.hostId, cwd: environment.path };
    }
  }

  const primaryHostId = requirePrimaryHostId(deps);
  const source = getProjectSourceByHost(deps.db, args.projectId, primaryHostId);
  if (source && source.type === "local_path") {
    return { hostId: source.hostId, cwd: source.path };
  }

  return { hostId: primaryHostId, cwd: null };
}

function toProviderCommand(command: HostProviderCommand): ProviderCommand {
  return {
    name: command.name,
    source: command.source,
    origin: command.origin,
    description: command.description,
    argumentHint: command.argumentHint,
  };
}

function toSkillCommand(entry: ResolvedSkillCatalogEntry): ProviderCommand {
  const { provenance, runtimeSource } = entry;
  return {
    name: runtimeSource.name,
    source: "skill",
    origin: provenance.kind === "project" ? "project" : "user",
    description: runtimeSource.description,
    argumentHint: null,
    ...(provenance.kind === "plugin" ? { pluginId: provenance.pluginId } : {}),
  };
}

/**
 * Collapse same-`(source, name)` collisions. Built-in agent commands are the
 * canonical row for their names; otherwise project-origin entries win over
 * user-origin ones. Cross-source duplicates (a `skill` and a `command` with the
 * same name) are intentionally retained — they are distinct invocations.
 */
function dedupeBySourceAndName(commands: ProviderCommand[]): ProviderCommand[] {
  const byKey = new Map<string, ProviderCommand>();
  for (const command of commands) {
    const key = `${command.source} ${command.name}`;
    const existing = byKey.get(key);
    if (!existing || commandOriginRank(command) > commandOriginRank(existing)) {
      byKey.set(key, command);
    }
  }
  return [...byKey.values()];
}

function commandOriginRank(command: ProviderCommand): number {
  switch (command.origin) {
    case "builtin":
      return 2;
    case "project":
      return 1;
    case "user":
      return 0;
  }
}

function compareCommands(a: ProviderCommand, b: ProviderCommand): number {
  // Section rank is the PRIMARY key so the flat response is grouped in the
  // composer menu's visual order (skills → project commands → user commands).
  // The composer walks this flat order for keyboard nav, so deriving both from
  // the shared `providerCommandSectionRank` keeps highlight/Arrow/Enter aligned
  // with the rendered sections. Within a section we keep the existing
  // prefix-then-alphabetical ordering.
  const bySection =
    providerCommandSectionRank(a) - providerCommandSectionRank(b);
  if (bySection !== 0) {
    return bySection;
  }
  // Same section + same name is a true tie: section rank (the primary key) is a
  // pure function of source+origin, so two entries that reach here already share
  // a section and therefore a source. A same-named skill and legacy command land
  // in different sections and are ordered by the section rank above.
  return a.name.localeCompare(b.name);
}

export interface BuildCommandListResponseArgs {
  commands: HostProviderCommand[];
  skillCatalog: readonly ResolvedSkillCatalogEntry[];
}

/**
 * Server policy over the daemon's raw command set: de-dup by `(source, name)`
 * (project wins), then section-grouped and alphabetically sorted. The section grouping mirrors the
 * composer menu's visual order so the flat response and the rendered sections
 * stay in lockstep. Filtering is local to the composer, so discovery runs once
 * per project/environment/provider snapshot rather than once per keystroke.
 */
export function buildCommandListResponse(
  args: BuildCommandListResponseArgs,
): CommandListResponse {
  return {
    commands: dedupeBySourceAndName([
      ...BUILT_IN_PROVIDER_COMMANDS,
      ...args.skillCatalog.map(toSkillCommand),
      ...args.commands.map(toProviderCommand),
    ]).sort(compareCommands),
  };
}
