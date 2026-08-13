export type StrideCategory =
  | "spoofing"
  | "tampering"
  | "repudiation"
  | "information_disclosure"
  | "denial_of_service"
  | "elevation_of_privilege"
  | "other";

export type StrideSegment = Exclude<StrideCategory, "other">;

export interface ThreatAggregate {
  targetSlug: string;
  counts: Record<StrideCategory, number>;
  total: number;
}

export interface ThreatSummary {
  slug: string;
  title: string;
  rawCategory: string;
  category: StrideCategory;
  severity: string | null;
  targetSlugs: string[];
  attackPathCount: number;
}

export interface StrideVocabulary {
  configured: boolean;
  aliases: ReadonlyMap<string, StrideSegment>;
  labels: Record<StrideSegment, string>;
}

export const STRIDE_SEGMENTS = [
  "spoofing",
  "tampering",
  "repudiation",
  "information_disclosure",
  "denial_of_service",
  "elevation_of_privilege",
] as const satisfies readonly StrideSegment[];

export const STRIDE_CATEGORIES = [
  ...STRIDE_SEGMENTS,
  "other",
] as const satisfies readonly StrideCategory[];

const DEFAULT_LABELS: Record<StrideSegment, string> = {
  spoofing: "Spoofing",
  tampering: "Tampering",
  repudiation: "Repudiation",
  information_disclosure: "Information disclosure",
  denial_of_service: "Denial of service",
  elevation_of_privilege: "Elevation of privilege",
};

function normalizedVocabularyValue(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll(/[\s-]+/gu, "_");
}

export function strideSegment(value: string): StrideSegment | null {
  const normalized = normalizedVocabularyValue(value);
  return STRIDE_SEGMENTS.find((category) => category === normalized) ?? null;
}

function readableLabel(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Unlabeled category";
}

function collectVocabularyAliases(
  value: unknown,
  aliases: Map<string, StrideSegment>,
  labels: Record<StrideSegment, string>,
  inherited: StrideSegment | null,
  depth: number,
): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    const category = strideSegment(value) ?? inherited;
    if (category) aliases.set(normalizedVocabularyValue(value), category);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectVocabularyAliases(entry, aliases, labels, inherited, depth + 1);
    }
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const record = value as Record<string, unknown>;
  const ownCategory = [
    record.category,
    record.stride,
    record.value,
    record.key,
    record.code,
    record.name,
  ].reduce<StrideSegment | null>((found, candidate) => {
    if (found || typeof candidate !== "string") return found;
    return strideSegment(candidate);
  }, null);
  const activeCategory = ownCategory ?? inherited;
  if (activeCategory) {
    for (const candidate of [
      record.id,
      record.key,
      record.code,
      record.value,
      record.name,
      record.label,
      record.slug,
    ]) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        aliases.set(normalizedVocabularyValue(candidate), activeCategory);
      }
    }
    if (typeof record.label === "string" && record.label.trim().length > 0) {
      labels[activeCategory] = readableLabel(record.label);
    } else if (
      typeof record.name === "string" &&
      record.name.trim().length > 0 &&
      strideSegment(record.name) === null
    ) {
      labels[activeCategory] = readableLabel(record.name);
    }
  }

  for (const [key, child] of Object.entries(record)) {
    const keyCategory = strideSegment(key);
    const category = keyCategory ?? activeCategory;
    if (category) aliases.set(normalizedVocabularyValue(key), category);
    collectVocabularyAliases(child, aliases, labels, category, depth + 1);
  }
}

export function methodologyVocabulary(value: unknown): StrideVocabulary {
  const aliases = new Map<string, StrideSegment>();
  const labels = { ...DEFAULT_LABELS };
  collectVocabularyAliases(value, aliases, labels, null, 0);
  return { configured: aliases.size > 0, aliases, labels };
}

export function categoryFromVocabulary(
  rawCategory: string,
  vocabulary: StrideVocabulary,
): StrideCategory {
  if (!vocabulary.configured) return "other";
  return (
    vocabulary.aliases.get(normalizedVocabularyValue(rawCategory)) ?? "other"
  );
}

export function emptyStrideCounts(): Record<StrideCategory, number> {
  return {
    spoofing: 0,
    tampering: 0,
    repudiation: 0,
    information_disclosure: 0,
    denial_of_service: 0,
    elevation_of_privilege: 0,
    other: 0,
  };
}

export function aggregateThreats(
  threats: readonly Pick<ThreatSummary, "category" | "targetSlugs">[],
): ThreatAggregate[] {
  const aggregates = new Map<string, ThreatAggregate>();
  for (const threat of threats) {
    for (const targetSlug of new Set(threat.targetSlugs)) {
      let aggregate = aggregates.get(targetSlug);
      if (!aggregate) {
        aggregate = {
          targetSlug,
          counts: emptyStrideCounts(),
          total: 0,
        };
        aggregates.set(targetSlug, aggregate);
      }
      aggregate.counts[threat.category] += 1;
      aggregate.total += 1;
    }
  }
  return [...aggregates.values()].sort((left, right) =>
    left.targetSlug.localeCompare(right.targetSlug),
  );
}

export function aggregatesByTarget(
  aggregates: readonly ThreatAggregate[],
): ReadonlyMap<string, ThreatAggregate> {
  return new Map(
    aggregates.map((aggregate) => [aggregate.targetSlug, aggregate]),
  );
}
