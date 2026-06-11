// In-process runner for the REAL `bb workflow` CLI handlers (the production
// commander registrations, not re-implementations). Only handlers whose
// import graph stays off `@bb/sdk/node` can run here — save/validate are
// commander + config + the /validation subpath — because apps/host-daemon's
// ambient `ws` module stub conflicts with the real `@types/ws` the SDK is
// typed against in this package's TS program (see the ws.d.ts blocker note in
// fake/workflows/cli-commands.test.ts).

import { Command } from "commander";
import { vi } from "vitest";

export interface WorkflowCliInvocation {
  stdout: string[];
}

export interface RunWorkflowCliArgs {
  /** argv after `node bb`, e.g. `["workflow", "validate", file]`. */
  argv: string[];
  /** The production commander registration for one `workflow` subcommand. */
  register: (parent: Command) => void;
}

/**
 * Run one real `bb workflow` subcommand in-process. stdout is captured per
 * invocation (each `console.log` call is one entry); a failing command
 * (`action()` prints the error and calls `process.exit`) surfaces as a
 * rejection carrying the captured stderr so test failures stay debuggable.
 */
export async function runWorkflowCli(
  args: RunWorkflowCliArgs,
): Promise<WorkflowCliInvocation> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...parts) => {
    stdout.push(parts.join(" "));
  });
  const errorSpy = vi
    .spyOn(console, "error")
    .mockImplementation((...parts) => {
      stderr.push(parts.join(" "));
    });
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit:${String(code ?? 0)}`);
  });
  try {
    const program = new Command();
    const workflow = program.command("workflow");
    args.register(workflow);
    await program.parseAsync(["node", "bb", ...args.argv]);
    return { stdout };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `bb ${args.argv.join(" ")} failed (${message}); stderr: ${stderr.join(" | ")}`,
    );
  } finally {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  }
}
