import { killProcessesWithCwdUnder } from "@bb/process-utils";

/**
 * Kills every process whose working directory is at or under any of `directories`,
 * SIGTERM first and SIGKILL after the grace, for a provider tearing down a
 * workspace it made. Plugins built against SDK 0.6.26 or earlier that still pass
 * `{ directory }` keep working at runtime. Experimental: see docs/api_to_audit.md.
 */
export function experimental_killProcessesWithCwdUnder(
  args: Parameters<typeof killProcessesWithCwdUnder>[0],
): ReturnType<typeof killProcessesWithCwdUnder> {
  if ("directory" in args && typeof args.directory === "string")
    return killProcessesWithCwdUnder({
      ...args,
      directories: [args.directory],
    });
  return killProcessesWithCwdUnder(args);
}
