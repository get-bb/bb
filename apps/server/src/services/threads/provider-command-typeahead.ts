import {
  getBuiltInAgentProviderInfo,
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

/**
 * Default `limit` applied when the route receives no `limit` query param.
 * Matches the composer mention menu cap so the command and mention menus show
 * the same number of rows.
 */
export const PROVIDER_COMMAND_DEFAULT_LIMIT = 8;

/**
 * Upper bound on the `limit` query param. Command/skill sets are small local
 * directories, so this only guards against absurd client requests.
 */
export const PROVIDER_COMMAND_LIMIT_MAX = 50;

export function providerHasCommandSurface(providerId: string): boolean {
  if (!isAgentProviderId(providerId)) {
    return false;
  }
  return getBuiltInAgentProviderInfo(providerId).composerActions.some(
    (action) => action.kind === "skills",
  );
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
  deps: Pick<AppDeps, "config" | "db">,
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

function commandSearchNames(command: ProviderCommand): string[] {
  const name = command.name.toLowerCase();
  if (command.source !== "skill") {
    return [name];
  }
  const separatorIndex = name.lastIndexOf(":");
  if (separatorIndex < 0 || separatorIndex === name.length - 1) {
    return [name];
  }
  return [name, name.slice(separatorIndex + 1)];
}

function matchesQuery(command: ProviderCommand, query: string): boolean {
  if (query === "") {
    return true;
  }
  if (commandSearchNames(command).some((name) => name.includes(query))) {
    return true;
  }
  return command.description !== null
    ? command.description.toLowerCase().includes(query)
    : false;
}

/**
 * Collapse same-`(source, name)` collisions, keeping the `project`-origin entry
 * over the `user`-origin one. Cross-source duplicates (a `skill` and a
 * `command` with the same name) are intentionally retained — they are distinct
 * invocations.
 */
function dedupeBySourceAndName(commands: ProviderCommand[]): ProviderCommand[] {
  const byKey = new Map<string, ProviderCommand>();
  for (const command of commands) {
    const key = `${command.source} ${command.name}`;
    const existing = byKey.get(key);
    if (
      !existing ||
      (existing.origin === "user" && command.origin === "project")
    ) {
      byKey.set(key, command);
    }
  }
  return [...byKey.values()];
}

function compareForQuery(
  a: ProviderCommand,
  b: ProviderCommand,
  query: string,
): number {
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
  if (query !== "") {
    const aPrefix = commandSearchNames(a).some((name) =>
      name.startsWith(query),
    );
    const bPrefix = commandSearchNames(b).some((name) =>
      name.startsWith(query),
    );
    if (aPrefix !== bPrefix) {
      return aPrefix ? -1 : 1;
    }
  }
  // Same section + same name is a true tie: section rank (the primary key) is a
  // pure function of source+origin, so two entries that reach here already share
  // a section and therefore a source. A same-named skill and legacy command land
  // in different sections and are ordered by the section rank above.
  return a.name.localeCompare(b.name);
}

export interface BuildCommandListResponseArgs {
  commands: HostProviderCommand[];
  limit: number;
  offset: number;
  query: string | undefined;
}

/**
 * Server policy over the daemon's raw command set: case-insensitive filter,
 * de-dup by `(source, name)` (project wins), section-grouped
 * (skills → project commands → user commands) then prefix-then-alphabetical
 * sort, offset, and truncation to `limit`. The section grouping mirrors the
 * composer menu's visual order so the flat response and the rendered sections
 * stay in lockstep. `truncated` reflects whether more rows remain after this
 * page, so the client can fetch the next page while keyboard navigation
 * approaches the end.
 */
export function buildCommandListResponse(
  args: BuildCommandListResponseArgs,
): CommandListResponse {
  const query = (args.query ?? "").toLowerCase();
  const filtered = dedupeBySourceAndName(
    args.commands
      .map(toProviderCommand)
      .filter((command) => matchesQuery(command, query)),
  ).sort((a, b) => compareForQuery(a, b, query));
  const end = args.offset + args.limit;

  return {
    commands: filtered.slice(args.offset, end),
    truncated: filtered.length > end,
  };
}
