export type Staleness = {
  dockerfileChanged: boolean;
  lockfilesChanged: boolean | null;
  reason: string | null;
  lastCheckedAt: number | null;
};

export function stalenessLabel(value: Staleness): string {
  if (value.dockerfileChanged && value.lockfilesChanged)
    return "Dockerfile and lockfiles changed — rebuild explicitly";
  if (value.dockerfileChanged) return "Dockerfile changed — rebuild explicitly";
  if (value.lockfilesChanged) return "Lockfiles changed — rebuild explicitly";
  if (value.lockfilesChanged === null)
    return value.reason ?? "Source not checked";
  return "Dockerfile and lockfiles match the recorded build";
}

export function runningHourlyEstimate(cpuCores: number, memoryMiB: number) {
  return 3600 * (cpuCores * 0.0000131 + (memoryMiB / 1024) * 0.00000222);
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The operation failed";
}

export function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
