import type { BbPluginApi, PluginCliResult } from "@get-bb/plugin-sdk";
import { autoChoiceKey, type RefusalFallbackService } from "./service.js";

interface RememberedChoice {
  providerId: string;
  model: string;
}

function textView(choices: readonly RememberedChoice[]): string {
  if (choices.length === 0) {
    return "No provider is set to switch models automatically after a refusal.";
  }
  return choices
    .map((choice) => `${choice.providerId} switches to ${choice.model}`)
    .join("\n");
}

async function listRememberedChoices(
  bb: BbPluginApi,
  service: RefusalFallbackService,
): Promise<RememberedChoice[]> {
  const keys = await bb.storage.kv.list("auto:");
  const choices: RememberedChoice[] = [];
  for (const key of keys) {
    const providerId = key.slice("auto:".length);
    if (providerId === "") continue;
    const stored = await service.autoChoice(providerId);
    if (stored === undefined) continue;
    choices.push({ providerId, model: stored.model });
  }
  return choices;
}

export function registerRefusalFallbackCli(
  bb: BbPluginApi,
  service: RefusalFallbackService,
): void {
  bb.cli.register({
    name: "refusal-fallback",
    summary: "Inspect and clear automatic model switches after a refusal.",
    commands: [
      {
        name: "status",
        summary: "Show which providers switch models automatically.",
        usage: "bb refusal-fallback status [--json]",
      },
      {
        name: "forget",
        summary: "Ask again the next time this provider refuses a message.",
        usage: "bb refusal-fallback forget <providerId>",
      },
      {
        name: "retry",
        summary: "Re-check a thread for a refusal that can fall back.",
        usage: "bb refusal-fallback retry [threadId]",
      },
    ],
    async run(argv, context): Promise<PluginCliResult> {
      const [command, ...args] = argv;
      const json = args.includes("--json");

      if (command === "status") {
        const choices = await listRememberedChoices(bb, service);
        return {
          exitCode: 0,
          stdout: json ? JSON.stringify({ choices }) : textView(choices),
        };
      }

      if (command === "forget") {
        const providerId = args.find((arg) => !arg.startsWith("-"));
        if (providerId === undefined) {
          return {
            exitCode: 1,
            stderr: "Usage: bb refusal-fallback forget <providerId>",
          };
        }
        await service.forget(providerId);
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify({ forgotten: providerId })
            : `${providerId} will ask again after the next refusal.`,
        };
      }

      if (command === "retry") {
        const threadId =
          args.find((arg) => !arg.startsWith("-")) ?? context.threadId;
        if (threadId === undefined) {
          return {
            exitCode: 1,
            stderr: "Usage: bb refusal-fallback retry <threadId>",
          };
        }
        const outcome = await service.reconcile(threadId);
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify({ threadId, outcome })
            : `${threadId}: ${outcome}`,
        };
      }

      return {
        exitCode: 1,
        stderr: "Unknown command. Try status, forget, or retry.",
      };
    },
  });
}
