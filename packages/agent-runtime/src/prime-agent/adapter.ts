import type { ProviderAdapter } from "../provider-adapter.js";
import { z } from "zod";
import { threadScope } from "@bb/domain";
import {
  createPiProtocolProviderAdapter,
  type CreatePiProviderAdapterOptions,
} from "../pi/adapter.js";

export type CreatePrimeAgentProviderAdapterOptions =
  CreatePiProviderAdapterOptions;

const primeSessionNameEventSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("sdk/message"),
  params: z.object({
    threadId: z.string().optional(),
    message: z.object({
      type: z.literal("session_info_changed"),
      name: z.string().min(1),
    }),
  }),
});

export function createPrimeAgentProviderAdapter(
  options?: CreatePrimeAgentProviderAdapterOptions,
): ProviderAdapter {
  const shared = createPiProtocolProviderAdapter({
    ...options,
    bridgeBundleFileName: "bb-prime-agent-bridge.mjs",
    bridgeRelativePath: "../prime-agent/bridge/bridge.js",
    providerId: "prime-agent",
  });

  return {
    ...shared,
    translateEvent(event, context) {
      const sessionNameEvent = primeSessionNameEventSchema.safeParse(event);
      if (sessionNameEvent.success) {
        return [
          {
            type: "thread/name/updated",
            threadId:
              sessionNameEvent.data.params.threadId ?? context?.threadId ?? "",
            providerThreadId: "",
            threadName: sessionNameEvent.data.params.message.name,
            scope: threadScope(),
          },
        ];
      }
      return shared.translateEvent(event, context);
    },
    buildCommandPlan(command) {
      if (
        command.type === "thread/start" ||
        command.type === "thread/resume" ||
        command.type === "thread/fork"
      ) {
        if (command.dynamicTools && command.dynamicTools.length > 0) {
          throw new Error(
            "Prime Agent does not support BB dynamic tools through native RPC.",
          );
        }
        if (command.disallowedTools && command.disallowedTools.length > 0) {
          throw new Error(
            "Prime Agent does not support per-thread disallowed tools through native RPC.",
          );
        }
      }

      if (command.type === "thread/fork") {
        throw new Error(
          'Provider "prime-agent" does not support forking threads.',
        );
      }

      if (command.type === "thread/name/set") {
        return {
          kind: "request",
          method: "thread/name/set",
          params: {
            threadId: command.providerThreadId,
            title: command.title,
          },
        };
      }

      const plan = shared.buildCommandPlan(command);
      if (command.type === "thread/resume" && plan.kind === "request") {
        return {
          ...plan,
          params: {
            ...plan.params,
            sourceThreadId: command.threadId,
          },
        };
      }
      return plan;
    },
  };
}
