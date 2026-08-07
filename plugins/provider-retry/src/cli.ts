import type { BbPluginApi, PluginCliContext } from "@bb/plugin-sdk";
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
    summary: "Inspect pending automatic provider retries",
    commands: [
      {
        name: "status",
        summary: "Show pending automatic provider retries",
        usage: "bb provider-retry status [thread-id] [--json]",
      },
    ],
    run(argv, context) {
      const [command, ...args] = argv;
      if (command !== "status") {
        return {
          exitCode: 2,
          stderr: "Usage: bb provider-retry status [thread-id] [--json]\n",
        };
      }

      const threadId = requestedThreadId(args, context);
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
