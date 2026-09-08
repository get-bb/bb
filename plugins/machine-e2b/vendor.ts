import { CommandExitError, Sandbox } from "e2b";

export interface ExecRequest {
  command: string[];
  timeoutMs: number;
  signal: AbortSignal;
  stdin?: string;
}
export interface Handle {
  sandboxId: string;
  executor: {
    exec(
      request: ExecRequest,
    ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  };
}
function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
function wrap(sandbox: Sandbox): Handle {
  return {
    sandboxId: sandbox.sandboxId,
    executor: {
      async exec(request) {
        request.signal.throwIfAborted();
        const command = await sandbox.commands.run(
          [
            "timeout",
            "--kill-after=1s",
            `${request.timeoutMs / 1000}s`,
            ...request.command,
          ]
            .map(quote)
            .join(" "),
          {
            background: true,
            stdin: request.stdin !== undefined,
            user: "root",
            timeoutMs: request.timeoutMs + 2000,
            requestTimeoutMs: 30_000,
            signal: request.signal,
          },
        );
        try {
          if (request.stdin !== undefined) {
            await command.sendStdin(request.stdin, {
              signal: request.signal,
              requestTimeoutMs: 30_000,
            });
            await command.closeStdin({
              signal: request.signal,
              requestTimeoutMs: 30_000,
            });
          }
          const result = await command.wait();
          request.signal.throwIfAborted();
          return {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
          };
        } catch (error) {
          if (!request.signal.aborted && error instanceof CommandExitError) {
            return {
              exitCode: error.exitCode,
              stdout: error.stdout,
              stderr: error.stderr,
            };
          }
          await command.kill().catch(() => {});
          throw error;
        } finally {
          await command.disconnect();
        }
      },
    },
  };
}

export function createVendor(apiKey: string) {
  const options = { apiKey, requestTimeoutMs: 30_000 };
  return {
    async find(key: string, signal: AbortSignal): Promise<string | null> {
      const pages = Sandbox.list({
        ...options,
        query: {
          metadata: { bbMachineKey: key },
          state: ["running", "paused"],
        },
        limit: 2,
      });
      let sandboxId: string | null = null;
      while (pages.hasNext) {
        signal.throwIfAborted();
        for (const sandbox of await pages.nextItems({ signal })) {
          if (sandboxId !== null)
            throw new Error(
              "Multiple E2B sandboxes match the allocation key; reconcile before retrying.",
            );
          if (sandbox.metadata?.bbMachineKey !== key)
            throw new Error("E2B metadata does not match the allocation key.");
          sandboxId = sandbox.sandboxId;
        }
      }
      return sandboxId;
    },
    async create(
      template: string,
      key: string,
      timeoutMs: number,
      signal: AbortSignal,
    ): Promise<Handle> {
      signal.throwIfAborted();
      return wrap(
        await Sandbox.create(template, {
          ...options,
          metadata: { bbMachineKey: key },
          timeoutMs,
          allowInternetAccess: true,
          signal: AbortSignal.timeout(30_000),
        }),
      );
    },
    async connect(
      sandboxId: string,
      timeoutMs: number,
      signal: AbortSignal,
    ): Promise<Handle> {
      return wrap(
        await Sandbox.connect(sandboxId, { ...options, timeoutMs, signal }),
      );
    },
    async pause(sandboxId: string, signal: AbortSignal): Promise<void> {
      await Sandbox.pause(sandboxId, { ...options, signal, keepMemory: true });
    },
    async kill(sandboxId: string, signal: AbortSignal): Promise<void> {
      await Sandbox.kill(sandboxId, { ...options, signal });
    },
  };
}
export type Vendor = ReturnType<typeof createVendor>;
