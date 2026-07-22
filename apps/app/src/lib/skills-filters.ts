import type { SkillProvider, SkillSummary } from "@bb/server-contract";
import { getProviderIconInfo } from "@/lib/provider-icon";

export function providerLabel(providerId: SkillProvider | null): string {
  if (providerId === null) {
    return "bb";
  }
  return getProviderIconInfo(providerId)?.ariaLabel ?? providerId;
}

export type ResourceProviderFilter = "bb" | SkillProvider;
export type ResourceSortMode = "provider" | "alpha";
export type ResourceSortDirection = "asc" | "desc";

export const RESOURCE_PROVIDER_FILTERS: readonly ResourceProviderFilter[] = [
  "bb",
  "claude-code",
  "codex",
];

export function skillProviderFilterId(
  skill: SkillSummary,
): ResourceProviderFilter {
  return skill.provider ?? "bb";
}

export function providerFilterLabel(provider: ResourceProviderFilter): string {
  if (provider === "bb") return "bb";
  return providerLabel(provider);
}

export function compareNullableProvider(
  left: SkillProvider | null,
  right: SkillProvider | null,
): number {
  return providerLabel(left).localeCompare(providerLabel(right));
}

export function applySortDirection(
  result: number,
  direction: ResourceSortDirection,
): number {
  return direction === "asc" ? result : -result;
}
