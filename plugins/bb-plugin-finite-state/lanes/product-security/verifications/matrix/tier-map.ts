import type { VerificationTier } from "./status.js";

export interface CheckModel {
  checkId: string;
  checkType: string;
  category: string | null;
  parameters: string | null;
  required: boolean;
}

export type BenchTier = "tier0" | "tier1" | "tier2" | "tier3" | "tier4";

export class TierMappingError extends Error {
  readonly code = "TIER_UNKNOWN" as const;

  constructor(readonly checkId: string, detail: string) {
    super(`TIER_UNKNOWN: ${detail}`);
    this.name = "TierMappingError";
  }
}

const STATIC_CHECK_TYPES = new Set([
  "config_check",
  "sbom_query",
  "binary_analysis",
  "binary_pattern",
  "vuln_absence",
]);
const MANUAL_CHECK_TYPES = new Set([
  "manual",
  "attestation",
  "document_review",
]);
const DYNAMIC_PARAMETER_KEYS = new Set([
  "bench_tier",
  "benchTier",
  "environment",
  "matrix_col",
  "matrixColumn",
  "tier",
]);

function normalizedCheckType(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll("-", "_");
}

function parseParameters(check: CheckModel): Record<string, unknown> {
  if (check.parameters === null || check.parameters.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(check.parameters);
  } catch {
    throw new TierMappingError(check.checkId, "dynamic parameters are not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TierMappingError(check.checkId, "dynamic parameters must be an object");
  }
  return Object.fromEntries(Object.entries(parsed));
}

function dynamicVocabularyTier(value: string): VerificationTier | null {
  const normalized = value.trim().toLocaleLowerCase().replaceAll("-", "_");
  if (
    normalized === "emulation" ||
    normalized === "tier1" ||
    normalized === "tier2" ||
    normalized === "qemu" ||
    normalized === "renode" ||
    normalized === "rehosted"
  ) return "emulation";
  if (
    normalized === "hil" ||
    normalized === "tier3" ||
    normalized === "hardware_in_the_loop"
  ) return "hil";
  return null;
}

function mapDynamicCheck(check: CheckModel): VerificationTier {
  const candidates = new Set<VerificationTier>();
  if (check.category) {
    const categoryTier = dynamicVocabularyTier(check.category);
    if (categoryTier) candidates.add(categoryTier);
  }
  for (const [key, value] of Object.entries(parseParameters(check))) {
    if (!DYNAMIC_PARAMETER_KEYS.has(key) || typeof value !== "string") continue;
    const parameterTier = dynamicVocabularyTier(value);
    if (parameterTier) candidates.add(parameterTier);
  }
  if (candidates.size !== 1) {
    const reason = candidates.size > 1
      ? "dynamic category and parameters disagree"
      : "dynamic check lacks a documented emulation/HIL discriminator";
    throw new TierMappingError(check.checkId, reason);
  }
  const [tier] = candidates;
  if (!tier) throw new TierMappingError(check.checkId, "dynamic tier is absent");
  return tier;
}

export function mapCheckToTier(check: CheckModel): VerificationTier {
  const type = normalizedCheckType(check.checkType);
  if (STATIC_CHECK_TYPES.has(type)) return "static";
  if (MANUAL_CHECK_TYPES.has(type)) return "manual";
  if (type === "external_sync") return "hil";
  if (type === "dynamic") return mapDynamicCheck(check);
  throw new TierMappingError(check.checkId, `unsupported check type ${check.checkType}`);
}

export function mapBenchTierToVerificationTier(tier: BenchTier): VerificationTier {
  if (tier === "tier0") return "static";
  if (tier === "tier1" || tier === "tier2") return "emulation";
  if (tier === "tier3") return "hil";
  return "manual";
}
