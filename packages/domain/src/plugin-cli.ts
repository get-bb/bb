/**
 * Core `bb` CLI top-level command names (plus commander's built-in help).
 * Core commands win these names; plugin scaffolding rejects them. Maintained
 * by hand and checked against the real Commander program by
 * apps/cli/src/__tests__/plugin-cli-proxy.test.ts.
 *
 * "automation" and "connect" are intentionally absent: builtin plugins own
 * those top-level commands and the CLI proxies them.
 */
export const RESERVED_BB_CLI_COMMANDS: readonly string[] = [
  "environment",
  "guide",
  "help",
  "manager",
  "plugin",
  "project",
  "provider",
  "skill",
  "status",
  "theme",
  "thread",
];

export function pluginCliCall(pluginId: string, name: string): string {
  if (RESERVED_BB_CLI_COMMANDS.includes(name))
    return `bb plugin run ${pluginId}`;
  return `bb ${name}`;
}
