import type {
  DefaultEnvironment,
  DefaultEnvironmentProblem,
} from "../src/rpc-types";

export interface ProjectDefaultEnvironmentProvider {
  id: string;
  displayName: string;
  icon: string | null;
  logoUrl: string | null;
}

export interface ProjectDefaultEnvironmentMachine {
  id: string;
  name: string;
}

export interface ProjectDefaultEnvironmentSummary {
  label: string;
  compactLabel: string;
  provider: ProjectDefaultEnvironmentProvider | null;
  hostId: string | null;
  problem: string | null;
}

const AUTOMATIC_LABEL = "Automatic";
const PROJECT_DEFAULT_LABEL = "Project default";
const PROJECT_DEFAULT_COMPACT_LABEL = "Default";

export function summarizeProjectDefaultEnvironment({
  defaultEnvironment,
  defaultEnvironmentProblem,
  providers,
  machines,
}: {
  defaultEnvironment: DefaultEnvironment | null;
  defaultEnvironmentProblem: DefaultEnvironmentProblem | null;
  providers: readonly ProjectDefaultEnvironmentProvider[];
  machines: readonly ProjectDefaultEnvironmentMachine[];
}): ProjectDefaultEnvironmentSummary {
  const problem = defaultEnvironmentProblem?.message ?? null;
  if (defaultEnvironment === null) {
    return {
      label: AUTOMATIC_LABEL,
      compactLabel: AUTOMATIC_LABEL,
      provider: null,
      hostId: null,
      problem,
    };
  }
  const provider =
    providers.find(
      (entry) => entry.id === defaultEnvironment.environmentProviderId,
    ) ?? null;
  const providerName =
    provider?.displayName ?? defaultEnvironment.environmentProviderId;
  const machine = defaultEnvironment.machine;
  if (machine.type === "new") {
    return {
      label: providerName,
      compactLabel: providerName,
      provider,
      hostId: null,
      problem,
    };
  }
  const machineName = machines.find((entry) => entry.id === machine.hostId)
    ?.name;
  return {
    label:
      machineName === undefined
        ? providerName
        : `${providerName} on ${machineName}`,
    compactLabel: providerName,
    provider,
    hostId: machine.hostId,
    problem,
  };
}

export function projectDefaultEnvironmentLabel(
  summary: ProjectDefaultEnvironmentSummary | null,
): string {
  if (summary === null) return PROJECT_DEFAULT_LABEL;
  const label = `${PROJECT_DEFAULT_LABEL} · ${summary.label}`;
  return summary.problem === null ? label : `${label} (unavailable)`;
}

export function projectDefaultEnvironmentCompactLabel(
  summary: ProjectDefaultEnvironmentSummary | null,
): string {
  return summary?.compactLabel ?? PROJECT_DEFAULT_COMPACT_LABEL;
}

export function projectDefaultEnvironmentRoutingHostId(
  summary: ProjectDefaultEnvironmentSummary | null,
): string | null {
  if (summary === null || summary.problem !== null) return null;
  return summary.hostId;
}
