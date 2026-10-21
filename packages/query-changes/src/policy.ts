import type {
  ReadChange,
  ReadDependency,
  ReadChangeReaction,
} from "@bb/domain";

export function matchesReadChange(
  dependency: ReadDependency,
  change: ReadChange,
): boolean {
  return (
    dependency.entity === change.entity &&
    (dependency.id === undefined ||
      change.id === undefined ||
      dependency.id === change.id) &&
    dependency.changes.some((kind) => change.changes.includes(kind))
  );
}

export function resolveReadChange<Data>(
  data: Data | undefined,
  dependencies: readonly ReadDependency[],
  change: ReadChange,
  react?: (
    data: Data | undefined,
    change: ReadChange,
  ) => ReadChangeReaction<Data>,
): ReadChangeReaction<Data> {
  if (change.entity === "plugin" && change.changes.includes("reset"))
    return { action: "reload" };
  try {
    const reaction = react?.(data, change);
    return (
      reaction ??
      (dependencies.some((dependency) => matchesReadChange(dependency, change))
        ? { action: "reload" }
        : undefined)
    );
  } catch (error) {
    console.error(
      "Read change reducer failed; reloading",
      { entity: change.entity, id: change.id, changes: change.changes },
      error,
    );
    return { action: "reload" };
  }
}

export function mapReadChange<Data, Key extends keyof Data & string>(
  data: Data | undefined,
  reaction: ReadChangeReaction<unknown>,
  key: Key,
  parse: (value: unknown) => Data[Key],
): ReadChangeReaction<Data> {
  if (reaction?.action !== "patch" || data === undefined)
    return reaction?.action === "reload" ? reaction : undefined;
  return {
    action: "patch",
    data: { ...data, [key]: parse(reaction.data) },
  };
}
