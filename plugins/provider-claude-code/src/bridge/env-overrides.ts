/**
 * Decodes the `shell_environment_policy.set.*` config keys the session params
 * encode (via the kit's `buildShellEnvironmentPolicyConfig`) back into the
 * plain environment-variable map the Claude Agent SDK session takes.
 */
export function extractEnvOverrides(
  config: Record<string, unknown> | undefined,
): Record<string, string> {
  const envOverrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(config ?? {})) {
    if (
      key.startsWith("shell_environment_policy.set.") &&
      typeof value === "string"
    ) {
      const envVar = key.slice("shell_environment_policy.set.".length);
      envOverrides[envVar] = value;
    }
  }
  return envOverrides;
}
