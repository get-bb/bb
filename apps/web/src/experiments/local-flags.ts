const LONG_SCALE = 0xfffffffffffffff;

type Variant = { key: string; rolloutPercentage: number };

type Condition = {
  rolloutPercentage: number | null;
  variant: string | null;
};

export type LocalFlag = {
  key: string;
  active: boolean;
  conditions: readonly Condition[];
  variants: readonly Variant[];
};

export type FlagDefinitions = ReadonlyMap<string, LocalFlag | "unsupported">;

export type LocalResult =
  | { kind: "assigned"; variant: string | null }
  | { kind: "inconclusive" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === false ||
    (Array.isArray(value) && value.length === 0) ||
    (isRecord(value) && Object.keys(value).length === 0)
  );
}

function readPercentage(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === "number" && value >= 0 && value <= 100
    ? value
    : undefined;
}

function readCondition(value: unknown): Condition | null {
  if (
    !isRecord(value) ||
    !isEmpty(value.properties) ||
    (value.aggregation_group_type_index !== undefined &&
      value.aggregation_group_type_index !== null)
  ) {
    return null;
  }
  const rolloutPercentage = readPercentage(value.rollout_percentage);
  if (rolloutPercentage === undefined) {
    return null;
  }
  const variant = value.variant;
  if (
    variant !== undefined &&
    variant !== null &&
    typeof variant !== "string"
  ) {
    return null;
  }
  return { rolloutPercentage, variant: variant || null };
}

function readVariants(value: unknown): Variant[] | null {
  if (isEmpty(value)) {
    return [];
  }
  if (!isRecord(value) || !Array.isArray(value.variants)) {
    return null;
  }
  const variants: Variant[] = [];
  for (const variant of value.variants) {
    const rolloutPercentage = isRecord(variant)
      ? readPercentage(variant.rollout_percentage)
      : undefined;
    if (
      !isRecord(variant) ||
      typeof variant.key !== "string" ||
      typeof rolloutPercentage !== "number"
    ) {
      return null;
    }
    variants.push({ key: variant.key, rolloutPercentage });
  }
  return variants;
}

function readFlag(value: Record<string, unknown>): LocalFlag | "unsupported" {
  const filters = value.filters;
  if (
    typeof value.key !== "string" ||
    typeof value.active !== "boolean" ||
    value.deleted === true ||
    value.ensure_experience_continuity === true ||
    !isRecord(filters) ||
    !isEmpty(filters.aggregation_group_type_index) ||
    !isEmpty(filters.holdout) ||
    !isEmpty(filters.holdout_groups) ||
    !isEmpty(filters.super_groups) ||
    !isEmpty(filters.feature_enrollment) ||
    !(
      isEmpty(filters.bucketing_identifier) ||
      filters.bucketing_identifier === "distinct_id"
    ) ||
    !(
      isEmpty(value.bucketing_identifier) ||
      value.bucketing_identifier === "distinct_id"
    ) ||
    !isEmpty(filters.early_exit) ||
    !Array.isArray(filters.groups)
  ) {
    return "unsupported";
  }
  const conditions: Condition[] = [];
  for (const group of filters.groups) {
    const condition = readCondition(group);
    if (condition === null) {
      return "unsupported";
    }
    conditions.push(condition);
  }
  const variants = readVariants(filters.multivariate);
  if (variants === null) {
    return "unsupported";
  }
  return { key: value.key, active: value.active, conditions, variants };
}

export function parseFlagDefinitions(body: unknown): FlagDefinitions | null {
  if (!isRecord(body) || !Array.isArray(body.flags)) {
    return null;
  }
  const definitions = new Map<string, LocalFlag | "unsupported">();
  for (const flag of body.flags) {
    if (isRecord(flag) && typeof flag.key === "string") {
      definitions.set(flag.key, readFlag(flag));
    }
  }
  return definitions;
}

export async function flagHash(
  key: string,
  distinctId: string,
  salt = "",
): Promise<number> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(`${key}.${distinctId}${salt}`),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return Number.parseInt(hex.slice(0, 15), 16) / LONG_SCALE;
}

async function matchingVariant(
  flag: LocalFlag,
  distinctId: string,
): Promise<string | null> {
  const hash = await flagHash(flag.key, distinctId, "variant");
  let min = 0;
  for (const variant of flag.variants) {
    const max = min + variant.rolloutPercentage / 100;
    if (hash >= min && hash < max) {
      return variant.key;
    }
    min = max;
  }
  return null;
}

export async function evaluateLocalFlag(
  definitions: FlagDefinitions,
  key: string,
  distinctId: string,
): Promise<LocalResult> {
  const flag = definitions.get(key);
  if (flag === undefined || flag === "unsupported") {
    return { kind: "inconclusive" };
  }
  if (!flag.active) {
    return { kind: "assigned", variant: null };
  }
  for (const condition of flag.conditions) {
    if (
      condition.rolloutPercentage !== null &&
      (await flagHash(flag.key, distinctId)) > condition.rolloutPercentage / 100
    ) {
      continue;
    }
    const override = flag.variants.some(
      (variant) => variant.key === condition.variant,
    )
      ? condition.variant
      : null;
    return {
      kind: "assigned",
      variant: override ?? (await matchingVariant(flag, distinctId)),
    };
  }
  return { kind: "assigned", variant: null };
}
