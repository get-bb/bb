type EnvironmentHostMode = "local" | "worktree";

interface ParsedHostEnvironmentValue {
  type: "host";
  hostId: string;
  mode: EnvironmentHostMode;
}

interface ParsedReuseEnvironmentValue {
  type: "reuse";
  environmentId: string | null;
}

interface ParsedWorktreePathEnvironmentValue {
  type: "worktree-path";
  hostId: string;
  canonicalPath: string;
}
export const REUSE_VALUE_WITHOUT_ENVIRONMENT = "reuse";

export type ParsedEnvironmentValue =
  | ParsedHostEnvironmentValue
  | ParsedReuseEnvironmentValue
  | ParsedWorktreePathEnvironmentValue
  | null;

export function encodeHostValue(
  hostId: string,
  mode: EnvironmentHostMode,
): string {
  return `host:${hostId}:${mode}`;
}

export function encodeReuseValue(environmentId: string): string {
  return `reuse:${environmentId}`;
}

export function encodeWorktreePathValue(
  hostId: string,
  canonicalPath: string,
): string {
  return `path:${encodeURIComponent(hostId)}:${encodeURIComponent(canonicalPath)}`;
}

function parseWorktreePathValue(
  value: string,
): ParsedWorktreePathEnvironmentValue | null {
  const segments = value.slice("path:".length).split(":");
  if (segments.length !== 2) {
    return null;
  }
  try {
    const hostId = decodeURIComponent(segments[0]);
    const canonicalPath = decodeURIComponent(segments[1]);
    if (hostId.length === 0 || canonicalPath.length === 0) {
      return null;
    }
    return { type: "worktree-path", hostId, canonicalPath };
  } catch {
    return null;
  }
}

export function parseEnvironmentValue(value: string): ParsedEnvironmentValue {
  if (value === REUSE_VALUE_WITHOUT_ENVIRONMENT) {
    return { type: "reuse", environmentId: null };
  }
  if (value.startsWith("host:")) {
    const parts = value.split(":");
    const hostId = parts[1];
    const mode = parts[2];
    if (hostId && (mode === "local" || mode === "worktree")) {
      return { type: "host", hostId, mode };
    }
  }
  if (value.startsWith("reuse:")) {
    const environmentId = value.slice("reuse:".length);
    if (environmentId.length > 0) {
      return { type: "reuse", environmentId };
    }
  }
  if (value.startsWith("path:")) {
    return parseWorktreePathValue(value);
  }
  return null;
}
