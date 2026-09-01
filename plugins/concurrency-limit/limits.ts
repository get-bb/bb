export const MAX_LIMIT_VALUE = 10_000;
export const MAX_AUTOMATIC_LIMIT = 8;

export interface HostLimitOverride {
  readonly hostId: string;
  readonly limit: number;
}

export interface LimitConfiguration {
  readonly globalLimit: number | null;
  readonly hostOverrides: readonly HostLimitOverride[];
}

export interface ResolvedHostLimit {
  readonly limit: number;
  readonly mode: "automatic" | "override";
}

export function automaticHostLimit(
  availableParallelism: number | null,
): number {
  if (availableParallelism === null) return 1;
  return Math.min(
    MAX_AUTOMATIC_LIMIT,
    Math.max(1, Math.floor(availableParallelism / 2)),
  );
}

export function resolveHostLimit(
  configuration: LimitConfiguration,
  hostId: string,
  availableParallelism: number | null,
): ResolvedHostLimit {
  const override = configuration.hostOverrides.find(
    (candidate) => candidate.hostId === hostId,
  );
  return override === undefined
    ? {
        limit: automaticHostLimit(availableParallelism),
        mode: "automatic",
      }
    : { limit: override.limit, mode: "override" };
}
