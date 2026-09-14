import { randomBytes } from "node:crypto";
import path from "node:path";
import type { BbPluginApi, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import {
  pcControlRpcContract,
  type AppProfile,
  type AppProfileInput,
  type HostSummary,
} from "./contract.js";
import { pcControlHostContract } from "./host-contract.js";
import { appProfileSchema } from "./pc/schemas.js";
import {
  formatBytes,
  formatUptime,
} from "./components/format.js";
import {
  PROFILE_LIMITS,
  argsFormError,
  cwdFormError,
  defaultProcessNameForExe,
  exePathFormError,
  nameFormError,
  processNameFormError,
} from "./pc/limits.js";

const PROFILES_STORAGE_KEY = "profiles";

type PcControlHostClient = ExperimentalHostClient<
  typeof pcControlHostContract
>;

export interface PcControlPluginDeps {
  createHostClient: (bb: BbPluginApi) => PcControlHostClient;
}

function newProfileId(): string {
  return `pcp_${randomBytes(8).toString("hex").slice(0, 12)}`;
}

function profileInputError(input: AppProfileInput): string | null {
  const nameError = nameFormError(input.name);
  if (nameError !== null) return nameError;
  const exeError = exePathFormError(input.exePath);
  if (exeError !== null) return exeError;
  const argsError = argsFormError(input.args);
  if (argsError !== null) return argsError;
  const cwd = input.cwd ?? path.dirname(input.exePath);
  const cwdError = cwdFormError(cwd);
  if (cwdError !== null) return cwdError;
  if (input.processName != null) {
    const processNameError = processNameFormError(input.processName);
    if (processNameError !== null) return processNameError;
  }
  return null;
}

function materializeProfile(
  input: AppProfileInput,
  existing: AppProfile | undefined,
): AppProfile {
  const now = Date.now();
  return appProfileSchema.parse({
    id: input.id ?? existing?.id ?? newProfileId(),
    name: input.name.trim(),
    exePath: input.exePath,
    args: input.args,
    cwd: input.cwd ?? path.dirname(input.exePath),
    processName: input.processName ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

function matchKeyFor(profile: AppProfile): string {
  return profile.id;
}

function processNameFor(profile: AppProfile): string {
  return profile.processName ?? defaultProcessNameForExe(profile.exePath);
}

export function createPcControlPlugin(deps?: PcControlPluginDeps) {
  return async function plugin(bb: BbPluginApi) {
    const createHostClient =
      deps?.createHostClient ??
      ((bbApi: BbPluginApi) =>
        bbApi.hosts.experimental_client({
          contract: pcControlHostContract,
        }));
    const hostClient = createHostClient(bb);

    async function loadProfiles(): Promise<AppProfile[]> {
      const stored = await bb.storage.kv.get(PROFILES_STORAGE_KEY);
      if (!Array.isArray(stored)) return [];
      const profiles: AppProfile[] = [];
      for (const entry of stored) {
        const parsed = appProfileSchema.safeParse(entry);
        if (parsed.success) profiles.push(parsed.data);
      }
      return profiles;
    }

    async function persistProfiles(profiles: readonly AppProfile[]) {
      await bb.storage.kv.set(PROFILES_STORAGE_KEY, [...profiles]);
    }

    async function resolveHost(): Promise<HostSummary> {
      const hosts = await bb.sdk.hosts.list().catch(() => []);
      if (hosts.length === 0) {
        throw new Error(
          "No machine is enrolled with this bb server yet. Connect this PC's host daemon first.",
        );
      }
      const connected = hosts.find((host) => host.status === "connected");
      const chosen = connected ?? hosts[0]!;
      return {
        id: chosen.id,
        name: chosen.name.length > 0 ? chosen.name : chosen.id,
        status: chosen.status,
      };
    }

    async function findProfile(idOrName: string): Promise<AppProfile | null> {
      const profiles = await loadProfiles();
      const lowered = idOrName.toLowerCase();
      return (
        profiles.find(
          (profile) =>
            profile.id === idOrName ||
            profile.name.toLowerCase() === lowered,
        ) ?? null
      );
    }

    async function stopProfileProcesses(
      profile: AppProfile,
    ): Promise<{ stoppedCount: number }> {
      const host = await resolveHost();
      const matches = await hostClient.call(
        "resolveProcessMatches",
        {
          matchers: [
            {
              key: matchKeyFor(profile),
              processName: processNameFor(profile),
              exePath: profile.exePath,
            },
          ],
        },
        { hostId: host.id },
      );
      const pids = matches.matches[0]?.pids ?? [];
      if (pids.length === 0) return { stoppedCount: 0 };
      return await hostClient.call(
        "stopProcesses",
        {
          pids,
          processName: processNameFor(profile),
          exePath: profile.exePath,
        },
        { hostId: host.id },
      );
    }

    async function startProfileProcess(
      profile: AppProfile,
    ): Promise<{ pid: number }> {
      const host = await resolveHost();
      return await hostClient.call(
        "startApp",
        {
          exePath: profile.exePath,
          args: profile.args,
          cwd: profile.cwd,
        },
        { hostId: host.id },
      );
    }

    async function getOverview() {
      const host = await resolveHost();
      try {
        const snapshot = await hostClient.call(
          "systemSnapshot",
          null,
          { hostId: host.id },
        );
        return { host, snapshot, error: null };
      } catch (error) {
        return {
          host,
          snapshot: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    async function getProcesses(input: {
      query?: string;
      sortBy: "cpu" | "memory";
      limit: number;
    }) {
      const host = await resolveHost();
      try {
        const listed = await hostClient.call(
          "listProcesses",
          null,
          { hostId: host.id },
        );
        const query = input.query?.trim().toLowerCase() ?? "";
        const filtered = listed.processes.filter((process) =>
          query.length === 0
            ? true
            : process.name.toLowerCase().includes(query) ||
              String(process.pid).includes(query),
        );
        const sorted = [...filtered].sort((a, b) => {
          if (input.sortBy === "memory") {
            return b.memoryBytes - a.memoryBytes;
          }
          const aCpu = a.cpuPercent ?? -1;
          const bCpu = b.cpuPercent ?? -1;
          if (aCpu !== bCpu) return bCpu - aCpu;
          return b.memoryBytes - a.memoryBytes;
        });
        return {
          collectedAt: listed.collectedAt,
          truncated: listed.truncated,
          totalMatched: filtered.length,
          hostError: null,
          processes: sorted.slice(0, input.limit),
        };
      } catch (error) {
        return {
          collectedAt: new Date().toISOString(),
          truncated: false,
          totalMatched: 0,
          hostError: error instanceof Error ? error.message : String(error),
          processes: [],
        };
      }
    }

    async function getProfilesWithStatus() {
      const storedProfiles = await loadProfiles();
      if (storedProfiles.length === 0) {
        return { host: null, profiles: [], error: null };
      }
      try {
        const host = await resolveHost();
        const matches = await hostClient.call(
          "resolveProcessMatches",
          {
            matchers: storedProfiles.map((profile) => ({
              key: matchKeyFor(profile),
              processName: processNameFor(profile),
              exePath: profile.exePath,
            })),
          },
          { hostId: host.id },
        );
        const pidsByKey = new Map(
          matches.matches.map((match) => [match.key, match.pids]),
        );
        return {
          host,
          profiles: storedProfiles.map((profile) => {
            const pids = pidsByKey.get(matchKeyFor(profile)) ?? [];
            return {
              ...profile,
              status: { running: pids.length > 0, pids },
            };
          }),
          error: null,
        };
      } catch (error) {
        return {
          host: null,
          profiles: storedProfiles.map((profile) => ({
            ...profile,
            status: { running: false, pids: [] },
          })),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    bb.rpc.register(pcControlRpcContract, {
      overview: () => getOverview(),
      processes: (input) => getProcesses(input),
      profiles: () => getProfilesWithStatus(),

      async saveProfile(input) {
        const inputError = profileInputError(input);
        if (inputError !== null) throw new Error(inputError);
        const profiles = await loadProfiles();
        const existing = input.id
          ? profiles.find((profile) => profile.id === input.id)
          : undefined;
        if (input.id !== undefined && existing === undefined) {
          throw new Error(`Profile ${input.id} no longer exists.`);
        }
        const profile = materializeProfile(input, existing);
        const nameClash = profiles.some(
          (candidate) =>
            candidate.id !== profile.id &&
            candidate.name.toLowerCase() === profile.name.toLowerCase(),
        );
        if (nameClash) {
          throw new Error(`A profile named "${profile.name}" already exists.`);
        }
        const next = existing
          ? profiles.map((candidate) =>
              candidate.id === profile.id ? profile : candidate,
            )
          : [...profiles, profile];
        if (next.length > PROFILE_LIMITS.maxProfiles) {
          throw new Error(
            `At most ${PROFILE_LIMITS.maxProfiles} profiles are supported.`,
          );
        }
        await persistProfiles(next);
        return { profile };
      },

      async deleteProfile({ id }) {
        const profiles = await loadProfiles();
        if (!profiles.some((profile) => profile.id === id)) {
          throw new Error(`Profile ${id} no longer exists.`);
        }
        await persistProfiles(
          profiles.filter((profile) => profile.id !== id),
        );
        return { ok: true as const };
      },

      async startProfile({ id }) {
        const profile = await findProfile(id);
        if (profile === null) {
          throw new Error(`Unknown profile "${id}".`);
        }
        return await startProfileProcess(profile);
      },

      async stopProfile({ id }) {
        const profile = await findProfile(id);
        if (profile === null) {
          throw new Error(`Unknown profile "${id}".`);
        }
        return await stopProfileProcesses(profile);
      },

      async restartProfile({ id }) {
        const profile = await findProfile(id);
        if (profile === null) {
          throw new Error(`Unknown profile "${id}".`);
        }
        await stopProfileProcesses(profile);
        return await startProfileProcess(profile);
      },
    });

    const USAGE = [
      "Usage:",
      "  bb pc status                                   Show CPU, memory, and uptime",
      "  bb pc processes [--sort cpu|memory] [--limit n] [--query text]",
      "                                                List top processes",
      "  bb pc apps [--json]                           List saved program profiles and status",
      "  bb pc start <profile>                         Start a saved profile (name or id)",
      "  bb pc stop <profile>                          Stop a saved profile's processes",
      "  bb pc restart <profile>                       Restart a saved profile",
      "",
      "Options:",
      "  --sort <key>     Sort processes by cpu (default) or memory",
      "  --limit <n>      Process rows to show (1-100, default 20)",
      "  --query <text>   Filter processes by name or pid",
      "  --json           Machine-readable output (status, processes, apps)",
    ].join("\n");

    bb.cli.register({
      name: "pc",
      summary: "Inspect this PC and manage saved program profiles",
      commands: [
        {
          name: "status",
          summary: "Show CPU, memory, and uptime",
          usage: "bb pc status [--json]",
        },
        {
          name: "processes",
          summary: "List top processes",
          usage:
            "bb pc processes [--sort cpu|memory] [--limit n] [--query text] [--json]",
        },
        {
          name: "apps",
          summary: "List saved program profiles and status",
          usage: "bb pc apps [--json]",
        },
        {
          name: "start",
          summary: "Start a saved program profile",
          usage: "bb pc start <profile>",
        },
        {
          name: "stop",
          summary: "Stop a saved program profile's processes",
          usage: "bb pc stop <profile>",
        },
        {
          name: "restart",
          summary: "Restart a saved program profile",
          usage: "bb pc restart <profile>",
        },
      ],
      async run(argv) {
        try {
          const [subcommand, ...rest] = argv;
          if (
            subcommand === undefined ||
            subcommand === "help" ||
            subcommand === "--help"
          ) {
            return { exitCode: 0, stdout: USAGE };
          }
          if (subcommand === "status") {
            return await runStatusCommand(rest);
          }
          if (subcommand === "processes") {
            return await runProcessesCommand(rest);
          }
          if (subcommand === "apps") {
            return await runAppsCommand(rest);
          }
          if (
            subcommand === "start" ||
            subcommand === "stop" ||
            subcommand === "restart"
          ) {
            return await runProfileMutationCommand(subcommand, rest);
          }
          return {
            exitCode: 1,
            stderr: `Unknown subcommand "${subcommand}".\n${USAGE}`,
          };
        } catch (error) {
          return {
            exitCode: 1,
            stderr: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });

    async function runStatusCommand(rest: readonly string[]) {
      const { present: asJson, rest: remaining } = consumeFlag(rest, "--json");
      const unexpected = remaining.filter((arg) => arg.startsWith("--"));
      if (unexpected.length > 0) {
        return {
          exitCode: 1,
          stderr: `Unexpected argument "${unexpected[0]}".\n${USAGE}`,
        };
      }
      const overview = await getOverview();
      if (asJson) {
        return { exitCode: 0, stdout: JSON.stringify(overview, null, 2) };
      }
      if (overview.error !== null) {
        return { exitCode: 1, stderr: overview.error };
      }
      const snapshot = overview.snapshot;
      if (snapshot === null) {
        return { exitCode: 1, stderr: "No snapshot was collected." };
      }
      const lines = [
        `Machine: ${overview.host.name} (${overview.host.status})`,
        `CPU: ${
          snapshot.cpuPercent === null
            ? "measuring…"
            : `${snapshot.cpuPercent.toFixed(1)}% of ${snapshot.cpuCores} cores`
        }`,
        `Memory: ${formatBytes(snapshot.memoryUsedBytes)} / ${formatBytes(
          snapshot.memoryTotalBytes,
        )} (${snapshot.memoryUsedPercent.toFixed(1)}%)`,
        `Uptime: ${formatUptime(snapshot.uptimeSeconds)}`,
      ];
      return { exitCode: 0, stdout: lines.join("\n") };
    }

    function consumeFlag(
      args: readonly string[],
      flag: string,
    ): { present: boolean; rest: string[] } {
      const remaining = [...args];
      const index = remaining.indexOf(flag);
      if (index === -1) return { present: false, rest: remaining };
      remaining.splice(index, 1);
      return { present: true, rest: remaining };
    }

    function consumeOption(
      args: readonly string[],
      name: string,
    ): { value: string | null; rest: string[] } {
      const remaining = [...args];
      const index = remaining.indexOf(name);
      if (index === -1) return { value: null, rest: remaining };
      const value = remaining[index + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${name}.`);
      }
      remaining.splice(index, 2);
      return { value, rest: remaining };
    }

    async function runProcessesCommand(rest: readonly string[]) {
      const { present: asJson, rest: withoutJson } = consumeFlag(rest, "--json");
      const sort = consumeOption(withoutJson, "--sort");
      const limit = consumeOption(sort.rest, "--limit");
      const query = consumeOption(limit.rest, "--query");
      if (sort.value !== null && sort.value !== "cpu" && sort.value !== "memory") {
        return {
          exitCode: 1,
          stderr: `--sort must be "cpu" or "memory".\n${USAGE}`,
        };
      }
      let limitNumber = 20;
      if (limit.value !== null) {
        if (!/^\d+$/u.test(limit.value)) {
          return {
            exitCode: 1,
            stderr: `--limit must be a number between 1 and 100.\n${USAGE}`,
          };
        }
        limitNumber = Number(limit.value);
        if (limitNumber < 1 || limitNumber > 100) {
          return {
            exitCode: 1,
            stderr: `--limit must be a number between 1 and 100.\n${USAGE}`,
          };
        }
      }
      const unexpected = query.rest.filter((arg) => arg.startsWith("--"));
      if (unexpected.length > 0) {
        return {
          exitCode: 1,
          stderr: `Unexpected argument "${unexpected[0]}".\n${USAGE}`,
        };
      }
      const result = await getProcesses({
        ...(query.value !== null ? { query: query.value } : {}),
        sortBy: sort.value === "memory" ? "memory" : "cpu",
        limit: limitNumber,
      });
      if (asJson) {
        return { exitCode: 0, stdout: JSON.stringify(result, null, 2) };
      }
      if (result.hostError !== null) {
        return { exitCode: 1, stderr: result.hostError };
      }
      if (result.processes.length === 0) {
        return { exitCode: 0, stdout: "No matching processes." };
      }
      const lines = result.processes.map(
        (process) =>
          `${process.pid}\t${
            process.cpuPercent === null ? "-" : process.cpuPercent.toFixed(1)
          }%\t${formatBytes(process.memoryBytes)}\t${process.name}`,
      );
      lines.push(
        `${result.totalMatched} matched${
          result.truncated ? " (host list capped)" : ""
        }; showing ${result.processes.length}.`,
      );
      return { exitCode: 0, stdout: lines.join("\n") };
    }

    async function runAppsCommand(rest: readonly string[]) {
      const { present: asJson, rest: remaining } = consumeFlag(rest, "--json");
      const unexpected = remaining.filter((arg) => arg.startsWith("--"));
      if (unexpected.length > 0) {
        return {
          exitCode: 1,
          stderr: `Unexpected argument "${unexpected[0]}".\n${USAGE}`,
        };
      }
      const result = await getProfilesWithStatus();
      if (asJson) {
        return { exitCode: 0, stdout: JSON.stringify(result, null, 2) };
      }
      if (result.error !== null) {
        return { exitCode: 1, stderr: result.error };
      }
      if (result.profiles.length === 0) {
        return {
          exitCode: 0,
          stdout:
            "No program profiles saved yet. Create one in the PC Control panel.",
        };
      }
      const lines = result.profiles.map((profile) =>
        [
          profile.id,
          profile.name,
          profile.status.running
            ? `running (${profile.status.pids.join(", ")})`
            : "stopped",
          profile.exePath,
        ].join("\t"),
      );
      return { exitCode: 0, stdout: lines.join("\n") };
    }

    async function runProfileMutationCommand(
      subcommand: string,
      rest: readonly string[],
    ) {
      const [target, ...extra] = rest;
      if (target === undefined || target.startsWith("--")) {
        return {
          exitCode: 1,
          stderr: `Usage: bb pc ${subcommand} <profile>\n${USAGE}`,
        };
      }
      if (extra.length > 0) {
        return {
          exitCode: 1,
          stderr: `Unexpected argument "${extra[0]}".\n${USAGE}`,
        };
      }
      const profile = await findProfile(target);
      if (profile === null) {
        return {
          exitCode: 1,
          stderr: `Unknown profile "${target}". Run bb pc apps to list profiles.`,
        };
      }
      if (subcommand === "start") {
        const started = await startProfileProcess(profile);
        return {
          exitCode: 0,
          stdout: `Started ${profile.name} (pid ${started.pid}).`,
        };
      }
      if (subcommand === "stop") {
        const stopped = await stopProfileProcesses(profile);
        return {
          exitCode: 0,
          stdout:
            stopped.stoppedCount > 0
              ? `Stopped ${profile.name} (${stopped.stoppedCount} process${
                  stopped.stoppedCount === 1 ? "" : "es"
                }).`
              : `${profile.name} was not running.`,
        };
      }
      await stopProfileProcesses(profile);
      const started = await startProfileProcess(profile);
      return {
        exitCode: 0,
        stdout: `Restarted ${profile.name} (pid ${started.pid}).`,
      };
    }
  };
}

export default createPcControlPlugin();
