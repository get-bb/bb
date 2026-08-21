import type { BbPluginApi, PluginCliContext } from "@get-bb/plugin-sdk";
import type { ProviderRetryView } from "./contract.js";
import type { ProviderRetryService } from "./service.js";

function requestedThreadId(
  argv: string[],
  context: PluginCliContext,
): string | null {
  return (
    argv.find((value) => !value.startsWith("--")) ?? context.threadId ?? null
  );
}

function textView(view: ProviderRetryView): string {
  const retry =
    view.retryAtMs === null
      ? "pending"
      : `retrying ${new Date(view.retryAtMs).toISOString()}`;
  return `${view.threadId}\t${view.providerId}\t${retry}`;
}

export function registerProviderRetryCli(
  bb: BbPluginApi,
  service: ProviderRetryService,
): void {
  bb.cli.register({
    name: "provider-retry",
    summary: "Manage pending automatic provider retries",
    commands: [
      {
        name: "status",
        summary: "Show pending automatic provider retries",
        usage: "bb provider-retry status [thread-id] [--json]",
      },
      {
        name: "cancel",
        summary: "Cancel a pending automatic provider retry",
        usage: "bb provider-retry cancel <thread-id> [--json]",
      },
      {
        name: "retry",
        summary: "Manually continue a provider-limited turn",
        usage: "bb provider-retry retry <thread-id> [--json]",
      },
    ],
    async run(argv, context) {
      const [command, ...args] = argv;
      if (command !== "status" && command !== "cancel" && command !== "retry") {
        return {
          exitCode: 2,
          stderr:
            "Usage: bb provider-retry <status|cancel|retry> [thread-id] [--json]\n",
        };
      }

      const threadId = requestedThreadId(args, context);
      if (command === "retry") {
        if (threadId === null) {
          return {
            exitCode: 2,
            stderr:
              "A thread id is required: bb provider-retry retry <thread-id>\n",
          };
        }
        const result = await service.retry(threadId);
        if (args.includes("--json")) {
          return {
            exitCode: 0,
            stdout: `${JSON.stringify({ threadId, ...result }, null, 2)}\n`,
          };
        }
        return {
          exitCode: 0,
          stdout: `Thread ${threadId} provider rate limit retry requested manually.\n`,
        };
      }
      if (command === "cancel") {
        if (threadId === null) {
          return {
            exitCode: 2,
            stderr:
              "A thread id is required: bb provider-retry cancel <thread-id>\n",
          };
        }
        const cancelled = await service.cancel(threadId);
        if (args.includes("--json")) {
          return {
            exitCode: cancelled ? 0 : 1,
            stdout: `${JSON.stringify({ cancelled }, null, 2)}\n`,
          };
        }
        return cancelled
          ? {
              exitCode: 0,
              stdout: `Cancelled provider retry for ${threadId}.\n`,
            }
          : {
              exitCode: 1,
              stderr: `No pending provider retry exists for ${threadId}.\n`,
            };
      }

      const views =
        threadId === null
          ? service.list()
          : [service.status(threadId)].filter(
              (view): view is ProviderRetryView => view !== null,
            );
      if (args.includes("--json")) {
        return {
          exitCode: 0,
          stdout: `${JSON.stringify({ retries: views }, null, 2)}\n`,
        };
      }
      return {
        exitCode: 0,
        stdout:
          views.length === 0
            ? "No provider retries are pending.\n"
            : `${views.map(textView).join("\n")}\n`,
      };
    },
  });
}
