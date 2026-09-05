interface CatalogPolicy {
  defaultMode: "always" | "discover" | "off";
  overrides: Record<string, "always" | "discover" | "off">;
}

export function filterInjectedSkillCatalog<T extends { name: string }>(
  sources: readonly T[],
  policy: CatalogPolicy | undefined,
): T[] {
  if (policy === undefined) return [...sources];
  return sources.filter(
    (source) =>
      (Object.hasOwn(policy.overrides, source.name)
        ? policy.overrides[source.name]
        : policy.defaultMode) === "always",
  );
}
