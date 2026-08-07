import type { BbPluginApi, PluginCliContext } from "@bb/plugin-sdk";
import type { ProviderRetryView } from "./contract.js";
import type { ProviderRetryService } from "./service.js";

function jsonResult(value: unknown) {
  return { exitCode: 0, stdout: `${JSON.stringify(value, null, 2)}\n` };
}

function textView(view: ProviderRetryView): string {
  if (view.phase === "waiting-for-host") {
    return `${view.threadId}\t${view.phase}\t${view.providerId}\twaiting for host`;
  }
  if (view.phase === "retry-failed") {
    return `${view.threadId}\t${view.phase}\t${view.providerId}\t${view.continuationError ?? "automatic continuation failed"}`;
  }
  if (view.phase === "manual-only") {
    const reset =
      view.resetsAtMs === null
        ? "unknown reset"
        : `resets ${new Date(view.resetsAtMs).toISOString()}`;
    return `${view.threadId}\t${view.phase}\t${view.providerId}\t${reset}; exceeds maximum automatic wait`;
  }
  const due =
    view.dueAtMs === null
      ? "no automatic reset"
      : new Date(view.dueAtMs).toISOString();
  return `${view.threadId}\t${view.phase}\t${view.providerId}\t${due}`;
}

function requestedThreadId(
  argv: string[],
  context: PluginCliContext,
): string | null {
  return (
    argv.find((value) => !value.startsWith("--")) ?? context.threadId ?? null
  );
}

function missingThreadId() {
  return {
    exitCode: 2,
    stderr: "A thread id is required (or run the command from a bb thread).\n",
  };
}

export function registerProviderRetryCli(
  bb: BbPluginApi,
  service: ProviderRetryService,
): void {
  bb.cli.register({
    name: "provider-retry",
    summary: "Inspect and control subscription rate-limit recovery",
    commands: [
      {
        name: "status",
        summary: "Show pending provider retries",
        usage: "bb provider-retry status [thread-id] [--json]",
      },
      {
        name: "now",
        summary: "Continue a safe rate-limited thread now",
        usage: "bb provider-retry now <thread-id> [--json]",
      },
      {
        name: "refresh",
        summary: "Refresh provider subscription usage",
        usage: "bb provider-retry refresh <thread-id> [--json]",
      },
      {
        name: "cancel",
        summary: "Cancel a pending automatic continuation",
        usage: "bb provider-retry cancel <thread-id> [--json]",
      },
    ],
    async run(argv, context) {
      const [command, ...args] = argv;
      const json = args.includes("--json");
      if (command === "status") {
        const threadId = requestedThreadId(args, context);
        const views =
          threadId === null
            ? service.list()
            : [service.status(threadId)].filter(
                (view): view is ProviderRetryView => view !== null,
              );
        if (json) return jsonResult({ retries: views });
        return {
          exitCode: 0,
          stdout:
            views.length === 0
              ? "No provider retries are pending.\n"
              : `${views.map(textView).join("\n")}\n`,
        };
      }

      const threadId = requestedThreadId(args, context);
      if (threadId === null) return missingThreadId();
      if (command === "now") {
        const started = await service.retryNow(threadId);
        if (json)
          return jsonResult({ started, view: service.status(threadId) });
        return {
          exitCode: started ? 0 : 1,
          stdout: started ? `Continued ${threadId}.\n` : "",
          stderr: started
            ? ""
            : `Thread ${threadId} is not currently safe to continue.\n`,
        };
      }
      if (command === "refresh") {
        const view = await service.refresh(threadId);
        if (json) return jsonResult({ view });
        return {
          exitCode: view?.refreshError ? 1 : 0,
          stdout:
            view === null
              ? `No provider retry is pending for ${threadId}.\n`
              : `${textView(view)}\n`,
          stderr: view?.refreshError ? `${view.refreshError}\n` : "",
        };
      }
      if (command === "cancel") {
        const cancelled = service.cancel(threadId);
        if (json) return jsonResult({ cancelled });
        return {
          exitCode: cancelled ? 0 : 1,
          stdout: cancelled
            ? `Cancelled provider retry for ${threadId}.\n`
            : "",
          stderr: cancelled
            ? ""
            : `No cancellable provider retry exists for ${threadId}.\n`,
        };
      }
      return {
        exitCode: 2,
        stderr:
          "Usage: bb provider-retry <status|now|refresh|cancel> [thread-id] [--json]\n",
      };
    },
  });
}
