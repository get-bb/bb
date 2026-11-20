import type { HostDaemonRpcCommand } from "@bb/host-daemon-contract";
import { registerTestHostRpcCapture } from "./commands.js";
import type { TestAppHarness } from "./test-app.js";

type HookRun = Extract<HostDaemonRpcCommand, { type: "environment.hook.run" }>;

export function holdEnvironmentHooks(
  harness: TestAppHarness,
  args: { hostId: string; sessionId: string },
) {
  const runs: HookRun[] = [];
  const pending: Array<{ resolve: () => void; reject: (error: Error) => void }> =
    [];
  registerTestHostRpcCapture(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    onEnvironmentHook: (command) => {
      runs.push(command);
      return new Promise<void>((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
  });
  const next = () => {
    const run = pending.shift();
    if (run === undefined) throw new Error("No environment hook is running");
    return run;
  };
  return {
    runs,
    finish: () => next().resolve(),
    fail: (message: string) => next().reject(new Error(message)),
  };
}
