export const MAX_LIMIT_VALUE = 10_000;

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

export function parseLimitValue(raw: string): number | null {
  if (!/^\d+$/u.test(raw)) return null;
  const value = Number(raw);
  return value <= MAX_LIMIT_VALUE ? value : null;
}

export function automaticHostLimit(
  availableParallelism: number | null,
): number {
  if (availableParallelism === null) return 1;
  return availableParallelism;
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

interface LimitConfigurationInput {
  globalLimit: number | null;
  hostOverrides: HostLimitOverride[];
}

export type LimitDraftCommit =
  | { readonly kind: "invalid" }
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "changed";
      readonly configuration: LimitConfigurationInput;
    };

function parseLimitDraft(
  raw: string,
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  const value = parseLimitValue(trimmed);
  return value === null ? { ok: false } : { ok: true, value };
}

export function commitGlobalLimitDraft(
  configuration: LimitConfiguration,
  draft: string,
): LimitDraftCommit {
  const parsed = parseLimitDraft(draft);
  if (!parsed.ok) return { kind: "invalid" };
  if (parsed.value === configuration.globalLimit) return { kind: "unchanged" };
  return {
    kind: "changed",
    configuration: {
      globalLimit: parsed.value,
      hostOverrides: [...configuration.hostOverrides],
    },
  };
}

export function commitHostLimitDraft(
  configuration: LimitConfiguration,
  hostId: string,
  draft: string,
): LimitDraftCommit {
  const parsed = parseLimitDraft(draft);
  if (!parsed.ok) return { kind: "invalid" };
  const existing = configuration.hostOverrides.find(
    (override) => override.hostId === hostId,
  );
  if (parsed.value === (existing?.limit ?? null)) return { kind: "unchanged" };
  const hostOverrides = configuration.hostOverrides.filter(
    (override) => override.hostId !== hostId,
  );
  if (parsed.value !== null)
    hostOverrides.push({ hostId, limit: parsed.value });
  return {
    kind: "changed",
    configuration: { globalLimit: configuration.globalLimit, hostOverrides },
  };
}
