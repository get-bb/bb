/**
 * Core `bb` CLI top-level command names (plus commander's built-in help).
 * Plugin CLI commands may not shadow these. Maintained by hand and checked
 * against the real Commander program by
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
