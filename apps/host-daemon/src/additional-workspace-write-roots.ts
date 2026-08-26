import path from "node:path";

export const ADDITIONAL_WORKSPACE_WRITE_ROOTS_ENV =
  "BB_ADDITIONAL_WORKSPACE_WRITE_ROOTS";

export function parseAdditionalWorkspaceWriteRoots(
  rawValue: string | undefined,
): string[] {
  if (rawValue === undefined) return [];

  const roots = rawValue
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter((root) => root.length > 0);
  const relativeRoot = roots.find((root) => !path.isAbsolute(root));
  if (relativeRoot !== undefined) {
    throw new Error(
      `${ADDITIONAL_WORKSPACE_WRITE_ROOTS_ENV} entries must be absolute paths: ${relativeRoot}`,
    );
  }

  return [...new Set(roots)];
}

export function loadAdditionalWorkspaceWriteRoots(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return parseAdditionalWorkspaceWriteRoots(
    env[ADDITIONAL_WORKSPACE_WRITE_ROOTS_ENV],
  );
}
