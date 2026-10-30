interface ParsedReuseEnvironmentValue {
  type: "reuse";
  environmentId: string | null;
}

interface ParsedProviderEnvironmentValue {
  type: "provider";
  environmentProviderId: string;
}

interface ParsedProjectDefaultEnvironmentValue {
  type: "project-default";
}

export const REUSE_VALUE_WITHOUT_ENVIRONMENT = "reuse";

export const PROJECT_DEFAULT_ENVIRONMENT_VALUE = "project-default";

const ENVIRONMENT_PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export type ParsedEnvironmentValue =
  | ParsedReuseEnvironmentValue
  | ParsedProviderEnvironmentValue
  | ParsedProjectDefaultEnvironmentValue
  | null;

export function encodeReuseValue(environmentId: string): string {
  return `reuse:${environmentId}`;
}

export function encodeProviderValue(environmentProviderId: string): string {
  return `provider:${environmentProviderId}`;
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

export function parseEnvironmentValue(value: string): ParsedEnvironmentValue {
  if (value === REUSE_VALUE_WITHOUT_ENVIRONMENT) {
    return { type: "reuse", environmentId: null };
  }
  if (value === PROJECT_DEFAULT_ENVIRONMENT_VALUE) {
    return { type: "project-default" };
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
  return null;
}
