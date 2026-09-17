import type { ToolCallResponse } from "@bb/domain";
import type { ServerLogger } from "../../types.js";

/**
 * How long a plugin tool call may hold its daemon round trip open before the
 * server answers with a stub and lets the call finish on its own.
 *
 * The daemon reaches the server with Node's global fetch, whose undici
 * defaults give up on an idle response after 300 seconds. Answering well
 * before that keeps the provider's tool result a deliberate message instead
 * of a transport error, on every provider.
 */
export const PLUGIN_TOOL_CALL_DETACH_AFTER_MS = 4 * 60_000;

export const PLUGIN_TOOL_CALL_DETACHED_RESULT_TEXT =
  "This tool call is still running. Its result is not the result of this call: it arrives later as a separate message, either during this turn or as the next one. Do not call the tool again for the same purpose and do not guess its result. If nothing else can proceed without it, end your turn with one short line saying what you are waiting for.";

export const PLUGIN_TOOL_CALL_LIFETIME_INSTRUCTIONS =
  "Plugin tools can take longer than a turn. When a plugin tool call returns a notice that it is still running, or your turn ends before it returns, its result arrives later as a separate message that names the tool. Treat that message as the call's result and continue from it; do not repeat the call.";

export interface RunPluginToolCallArgs {
  pluginId: string;
  threadId: string;
  callId: string;
  toolName: string;
  /** Aborts when the daemon stops reading the round trip. */
  roundTrip: AbortSignal;
  invoke(signal: AbortSignal): Promise<ToolCallResponse>;
  onDetachedResult(response: ToolCallResponse): Promise<void>;
}

interface TrackedPluginToolCall {
  pluginId: string;
  threadId: string;
  callId: string;
  toolName: string;
  controller: AbortController;
}

function failedToolCallResponse(
  toolName: string,
  error: unknown,
): ToolCallResponse {
  return {
    success: false,
    contentItems: [
      {
        type: "inputText",
        text: `Tool "${toolName}" failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
  };
}

export class PluginToolCallRegistry {
  private readonly calls = new Set<TrackedPluginToolCall>();
  private readonly detachAfterMs: number;
  private readonly logger: ServerLogger;

  constructor(args: { logger: ServerLogger; detachAfterMs?: number }) {
    this.logger = args.logger;
    this.detachAfterMs = args.detachAfterMs ?? PLUGIN_TOOL_CALL_DETACH_AFTER_MS;
  }

  run(args: RunPluginToolCallArgs): Promise<ToolCallResponse> {
    const controller = new AbortController();
    const tracked: TrackedPluginToolCall = {
      pluginId: args.pluginId,
      threadId: args.threadId,
      callId: args.callId,
      toolName: args.toolName,
      controller,
    };
    this.calls.add(tracked);

    return new Promise<ToolCallResponse>((resolve) => {
      let detached = false;
      let settled = false;
      const detach = () => {
        if (settled || detached) return;
        detached = true;
        clearTimeout(deadline);
        args.roundTrip.removeEventListener("abort", detach);
      };
      const deadline = setTimeout(() => {
        if (settled || detached) return;
        detach();
        resolve({
          success: true,
          contentItems: [
            { type: "inputText", text: PLUGIN_TOOL_CALL_DETACHED_RESULT_TEXT },
          ],
        });
      }, this.detachAfterMs);
      deadline.unref?.();
      args.roundTrip.addEventListener("abort", detach, { once: true });

      const settle = (response: ToolCallResponse) => {
        settled = true;
        clearTimeout(deadline);
        args.roundTrip.removeEventListener("abort", detach);
        this.calls.delete(tracked);
        if (!detached) {
          resolve(response);
          return;
        }
        if (controller.signal.aborted) {
          this.logger.info(
            {
              threadId: args.threadId,
              callId: args.callId,
              tool: args.toolName,
              reason: controller.signal.reason,
            },
            "Dropped a detached plugin tool result after its thread or plugin went away",
          );
          return;
        }
        void args.onDetachedResult(response).catch((error: unknown) => {
          this.logger.warn(
            {
              err: error,
              threadId: args.threadId,
              callId: args.callId,
              tool: args.toolName,
            },
            "Failed to deliver a detached plugin tool result",
          );
        });
      };

      let invocation: Promise<ToolCallResponse>;
      try {
        invocation = args.invoke(controller.signal);
      } catch (error) {
        invocation = Promise.reject(error);
      }
      invocation.then(settle, (error: unknown) => {
        settle(failedToolCallResponse(args.toolName, error));
      });
    });
  }

  abortForThreads(threadIds: readonly string[], reason: string): void {
    const ids = new Set(threadIds);
    for (const call of this.calls) {
      if (ids.has(call.threadId)) call.controller.abort(reason);
    }
  }

  abortForPlugin(pluginId: string, reason: string): void {
    for (const call of this.calls) {
      if (call.pluginId === pluginId) call.controller.abort(reason);
    }
  }

  get size(): number {
    return this.calls.size;
  }
}

let registry: PluginToolCallRegistry | undefined;

export function setPluginToolCallRegistry(
  next: PluginToolCallRegistry | undefined,
): void {
  registry = next;
}

export function requirePluginToolCallRegistry(): PluginToolCallRegistry {
  if (!registry) {
    throw new Error("Plugin tool call registry is not installed");
  }
  return registry;
}

export function abortPluginToolCallsForThreads(
  threadIds: readonly string[],
  reason: string,
): void {
  registry?.abortForThreads(threadIds, reason);
}

export function abortPluginToolCallsForPlugin(
  pluginId: string,
  reason: string,
): void {
  registry?.abortForPlugin(pluginId, reason);
}
