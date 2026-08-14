export function resolvedTaraScope(
  workspaceProjectId: string,
  projectVersionId = "version-1",
) {
  const selected = {
    platformProjectId: workspaceProjectId,
    projectVersionId,
    asOf: "2026-08-14T12:00:00.000Z",
  };
  return {
    versions: [selected],
    selected,
    source: "latest" as const,
    legacy: null,
  };
}

export function resolveTestTaraScope(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Expected TARA scope input.");
  }
  const workspaceProjectId = Reflect.get(input, "workspaceProjectId");
  if (typeof workspaceProjectId !== "string") {
    throw new Error("Expected workspaceProjectId.");
  }
  return resolvedTaraScope(workspaceProjectId);
}
