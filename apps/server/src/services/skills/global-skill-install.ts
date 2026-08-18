import { listHosts, listNonDestroyedHostsByIds } from "@bb/db";
import type {
  CliSkillMachineStatus,
  SystemCliSkillsStatusResponse,
  SystemInstallCliSkillsResponse,
} from "@bb/server-contract";
import type {
  HostGlobalSkillsStatusResult,
  HostInstallGlobalSkill,
} from "@bb/host-daemon-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { resolveServerOwnedSkillCatalogEntries } from "./injected-skills.js";

/**
 * The built-in skills published to a machine's global agent skill roots so
 * agents running outside bb can drive bb through its CLI.
 */
export const GLOBAL_CLI_SKILL_NAMES: readonly string[] = ["bb-cli"];

/**
 * Status reads are a page-load nicety, so they give up well before the install
 * timeout rather than holding the settings row on a wedged machine.
 */
const STATUS_TIMEOUT_MS = 5_000;

/** Every enrolled machine, for callers that did not name any. */
export function listInstallableMachineIds(
  deps: GlobalSkillInstallDeps,
): string[] {
  return listHosts(deps.db).map((host) => host.id);
}

export type InstallGlobalCliSkillsResult = SystemInstallCliSkillsResponse;

type GlobalSkillInstallDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "machineAuth"
  | "providerRegistry"
  | "pluginHostArtifacts"
  | "skillTreeRegistry"
  | "telemetry"
>;

export interface InstallGlobalCliSkillsArgs {
  hostIds: readonly string[];
}

/**
 * Resolve the built-in CLI skills as tree sources. Resolution also registers
 * each tree hash with the skill tree registry, which is what lets a daemon
 * pull the tree bytes back over the internal skill-tree route.
 */
function resolveGlobalCliSkills(
  deps: GlobalSkillInstallDeps,
): HostInstallGlobalSkill[] {
  return resolveServerOwnedSkillCatalogEntries({
    builtinSkillsRootPath: deps.config.builtinSkillsRootPath,
    dataDir: deps.config.dataDir,
    logger: deps.logger,
    skillTreeRegistry: deps.skillTreeRegistry,
  }).flatMap(({ provenance, runtimeSource }) =>
    provenance.kind === "builtin" &&
    runtimeSource.kind === "tree" &&
    GLOBAL_CLI_SKILL_NAMES.includes(runtimeSource.name)
      ? [
          {
            name: runtimeSource.name,
            treeHash: runtimeSource.treeHash,
            entryPath: runtimeSource.entryPath,
          },
        ]
      : [],
  );
}

/**
 * Compare what a machine has installed against what this server would install.
 * Every expected copy must match for "installed"; nothing present at all is
 * "missing"; anything in between (stale bytes, one root only) is "outdated".
 */
function resolveMachineSkillStatus(args: {
  entries: HostGlobalSkillsStatusResult["entries"];
  skills: readonly HostInstallGlobalSkill[];
}): CliSkillMachineStatus {
  const expectedByName = new Map(
    args.skills.map((skill) => [skill.name, skill.treeHash]),
  );
  const relevant = args.entries.filter((entry) =>
    expectedByName.has(entry.name),
  );
  if (relevant.length === 0 || relevant.every((e) => e.treeHash === null)) {
    return "missing";
  }
  return relevant.every(
    (entry) => entry.treeHash === expectedByName.get(entry.name),
  )
    ? "installed"
    : "outdated";
}

/**
 * Read each requested machine's install status. A machine that is offline or
 * fails to answer reports "unknown" rather than failing the whole read — the
 * settings row still renders for the machines that did answer.
 */
export async function readGlobalCliSkillStatus(
  deps: GlobalSkillInstallDeps,
  args: InstallGlobalCliSkillsArgs,
): Promise<SystemCliSkillsStatusResponse> {
  const hosts = listNonDestroyedHostsByIds(deps.db, args.hostIds);
  const skills = resolveGlobalCliSkills(deps);
  const machines = await Promise.all(
    hosts.map(async (host) => {
      const base = { hostId: host.id, hostName: host.name };
      if (skills.length === 0 || !deps.hub.hasDaemonForHost(host.id)) {
        return { ...base, status: "unknown" as const };
      }
      try {
        const result = await callHostOnlineRpc(deps, {
          hostId: host.id,
          timeoutMs: STATUS_TIMEOUT_MS,
          command: {
            type: "host.global_skills_status",
            names: skills.map((skill) => skill.name),
          },
        });
        return {
          ...base,
          status: resolveMachineSkillStatus({
            entries: result.entries,
            skills,
          }),
        };
      } catch (error) {
        deps.logger.debug(
          { hostId: host.id, err: error },
          "Could not read the bb CLI skill status from a machine",
        );
        return { ...base, status: "unknown" as const };
      }
    }),
  );
  return { machines };
}

function installFailureMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().length > 0 ? message : "The install failed";
}

/**
 * Copy the built-in bb CLI skills onto each requested machine. The server picks
 * the skills; each daemon owns the destinations. Machines install concurrently
 * and independently, so one offline machine never blocks the others.
 */
export async function installGlobalCliSkills(
  deps: GlobalSkillInstallDeps,
  args: InstallGlobalCliSkillsArgs,
): Promise<InstallGlobalCliSkillsResult> {
  const hosts = listNonDestroyedHostsByIds(deps.db, args.hostIds);
  const missingHostId = args.hostIds.find(
    (hostId) => !hosts.some((host) => host.id === hostId),
  );
  if (missingHostId !== undefined) {
    throw new ApiError(
      404,
      "host_not_found",
      `Machine ${missingHostId} was not found`,
    );
  }
  const skills = resolveGlobalCliSkills(deps);
  if (skills.length === 0) {
    throw new ApiError(
      500,
      "cli_skill_unavailable",
      "The built-in bb CLI skill is unavailable on this server",
    );
  }

  const results = await Promise.all(
    hosts.map(async (host) => {
      try {
        const result = await callHostOnlineRpc(deps, {
          hostId: host.id,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: { type: "host.install_global_skills", skills },
        });
        return {
          ok: true as const,
          hostId: host.id,
          hostName: host.name,
          installations: [...result.installations],
        };
      } catch (error) {
        deps.logger.warn(
          { hostId: host.id, err: error },
          "Failed to install the bb CLI skills on a machine",
        );
        return {
          ok: false as const,
          hostId: host.id,
          hostName: host.name,
          errorMessage: installFailureMessage(error),
        };
      }
    }),
  );
  return { results };
}
