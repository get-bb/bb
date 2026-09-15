interface ParsedReuseEnvironmentValue {
  type: "reuse";
  environmentId: string | null;
}

interface ParsedProviderEnvironmentValue {
  type: "provider";
  environmentProviderId: string;
}

interface ParsedWorktreePathEnvironmentValue {
  type: "worktree-path";
  hostId: string;
  canonicalPath: string;
}

export const REUSE_VALUE_WITHOUT_ENVIRONMENT = "reuse";

const ENVIRONMENT_PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export type ParsedEnvironmentValue =
  | ParsedReuseEnvironmentValue
  | ParsedProviderEnvironmentValue
  | ParsedWorktreePathEnvironmentValue
  | null;

export function encodeReuseValue(environmentId: string): string {
  return `reuse:${environmentId}`;
}

export function encodeProviderValue(environmentProviderId: string): string {
  return `provider:${environmentProviderId}`;
}

export function encodeWorktreePathValue(
  hostId: string,
  canonicalPath: string,
): string {
  return `path:${encodeURIComponent(hostId)}:${encodeURIComponent(canonicalPath)}`;
}

function parseProviderValue(
  value: string,
): ParsedProviderEnvironmentValue | null {
  const environmentProviderId = value.slice("provider:".length);
  if (!ENVIRONMENT_PROVIDER_ID_PATTERN.test(environmentProviderId)) {
    return null;
  }
  return { type: "provider", environmentProviderId };
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
  if (value.startsWith("reuse:")) {
    const environmentId = value.slice("reuse:".length);
    if (environmentId.length > 0) {
      return { type: "reuse", environmentId };
    }
  }
  if (value.startsWith("provider:")) {
    return parseProviderValue(value);
  }
  if (value.startsWith("path:")) {
    return parseWorktreePathValue(value);
  }
  return null;
}
