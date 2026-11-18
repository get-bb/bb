export const EXPERIMENT_VARIANTS = {
  "homepage-qa-check": ["test"],
  "homepage-download-path": ["test"],
  "homepage-hero": ["test"],
  "homepage-below-fold": ["test"],
} as const satisfies Record<string, readonly string[]>;

export type ExperimentKey = keyof typeof EXPERIMENT_VARIANTS;

export type ExperimentVariant<K extends ExperimentKey> =
  | "control"
  | (typeof EXPERIMENT_VARIANTS)[K][number];

export const EXPERIMENT_KEYS = Object.keys(
  EXPERIMENT_VARIANTS,
) as ExperimentKey[];

export const EXPERIMENT_PATHS: ReadonlySet<string> = new Set(["/"]);

export const SITE_WIDE_EXPERIMENTS: readonly ExperimentKey[] = [
  "homepage-download-path",
];

export const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";

export type ExperimentDevices = "all" | "desktop" | "touch";

export type ExperimentBootstrap = {
  distinctID: string | null;
  featureFlags: Readonly<Record<string, string>>;
  preview: boolean;
};

export const NO_EXPERIMENTS: ExperimentBootstrap = {
  distinctID: null,
  featureFlags: {},
  preview: false,
};

const VARIANT_PATTERN = /^[a-z0-9_-]{1,64}$/i;

export function isVariantName(value: string): boolean {
  return VARIANT_PATTERN.test(value);
}

export function isExperimentKey(value: string): value is ExperimentKey {
  return Object.hasOwn(EXPERIMENT_VARIANTS, value);
}

export function isKnownVariant(
  key: ExperimentKey,
  value: string | undefined,
): boolean {
  const known: readonly string[] = EXPERIMENT_VARIANTS[key];
  return value === "control" || (value !== undefined && known.includes(value));
}

export function experimentVariant<K extends ExperimentKey>(
  bootstrap: ExperimentBootstrap,
  key: K,
): ExperimentVariant<K> {
  const value = bootstrap.featureFlags[key];
  return isKnownVariant(key, value)
    ? (value as ExperimentVariant<K>)
    : "control";
}

export function parseForcedFlags(
  searchParams: URLSearchParams,
): Record<string, string> | null {
  const values = searchParams.getAll("ph_flag");
  if (values.length === 0) {
    return null;
  }
  const forced: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf(":");
    const key = value.slice(0, separator);
    const variant = value.slice(separator + 1);
    if (separator > 0 && isExperimentKey(key) && isVariantName(variant)) {
      forced[key] = variant;
    }
  }
  return forced;
}
