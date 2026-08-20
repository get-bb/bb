import type { Host } from "@bb/domain";
import type {
  CliSkillMachineStatus,
  SystemCliSkillsStatusResponse,
  SystemInstallCliSkillsResponse,
} from "@bb/server-contract";

/**
 * bb CLI skills install presentation (mirror of the pure parts of
 * apps/app/src/components/settings/CliSkillsSettingsSection.tsx and
 * InstallCliSkillsDialog.tsx).
 */

export const CLI_SKILLS_SETTING_LABEL = "bb CLI skills";

export function cliSkillsInstallDescription(
  hasConnectedMachine: boolean,
): string {
  return hasConnectedMachine
    ? "Install them into ~/.agents/skills and ~/.claude/skills so agents outside bb can use the bb CLI."
    : "Connect a machine to install them into ~/.agents/skills and ~/.claude/skills.";
}

/**
 * One badge for the whole row. With several machines the interesting fact is
 * how many are current, so a mixed fleet reports the shortfall rather than
 * claiming either extreme.
 */
export function summarizeMachineStatuses(
  statuses: readonly CliSkillMachineStatus[],
): string | null {
  const known = statuses.filter((status) => status !== "unknown");
  if (known.length === 0) return null;
  const installed = known.filter((status) => status === "installed").length;
  if (installed === known.length) {
    return known.length > 1
      ? `Installed on ${known.length} machines`
      : "Installed";
  }
  if (installed > 0) {
    return `Installed on ${installed} of ${known.length} machines`;
  }
  return known.some((status) => status === "outdated")
    ? "Out of date"
    : "Not installed";
}

export function cliSkillsStatusByHostId(
  status: SystemCliSkillsStatusResponse | undefined,
): ReadonlyMap<string, CliSkillMachineStatus> {
  return new Map(
    (status?.machines ?? []).map((machine) => [machine.hostId, machine.status]),
  );
}

const MACHINE_STATUS_LABELS: Record<CliSkillMachineStatus, string | null> = {
  installed: "Installed",
  outdated: "Out of date",
  missing: "Not installed",
  unknown: null,
};

/** The per-machine line in the install picker; offline machines cannot receive files. */
export function cliSkillsMachineStatusLabel(args: {
  host: Host;
  status: CliSkillMachineStatus | undefined;
}): string | null {
  if (args.host.status !== "connected") return "Disconnected";
  return args.status === undefined ? null : MACHINE_STATUS_LABELS[args.status];
}

export interface CliSkillsInstallReport {
  successMessage: string | null;
  failureMessages: string[];
}

/**
 * The route installs machines independently, so a partial success is a real
 * outcome and both halves get surfaced.
 */
export function describeCliSkillsInstallResults(
  result: SystemInstallCliSkillsResponse,
): CliSkillsInstallReport {
  const installed = result.results.filter((entry) => entry.ok);
  const failed = result.results.filter(
    (entry): entry is Extract<typeof entry, { ok: false }> => !entry.ok,
  );
  return {
    successMessage:
      installed.length > 0
        ? `Installed the bb CLI skills on ${installed
            .map((entry) => entry.hostName)
            .join(", ")}`
        : null,
    failureMessages: failed.map(
      (entry) => `${entry.hostName}: ${entry.errorMessage}`,
    ),
  };
}
