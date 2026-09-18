import { AsyncLocalStorage } from "node:async_hooks";
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
  "This tool call is still running. This notice is not its result. A successful result will arrive as a separate message that names the tool, either later in this turn or at the start of a new one. Failures are reported only while a turn is active. Do not call the tool again for the same purpose and do not guess its result. If nothing else can proceed without it, end your turn with one short line saying what you are waiting for.";

export const PLUGIN_TOOL_CALL_AWAITING_PERSON_RESULT_TEXT =
  "The person now has this request in front of them in the thread. This notice is not their response. If they submit it successfully, the result will arrive as a separate message that names the tool, either later in this turn or at the start of a new one. Dismissals and failures are reported only while a turn is active. Do not call the tool again, do not guess the answer, and do not start work that depends on it. Continue any independent work. If you cannot proceed without the response, end your turn with one short line saying what you are waiting for.";

export const PLUGIN_TOOL_CALL_LIFETIME_INSTRUCTIONS =
  "Some tools take longer than a turn. If a tool call returns a notice that it is still running or is waiting on the person, or your turn ends before it returns, a successful result arrives later as a separate message that names the tool. Treat that message as the call's result and continue from it; do not repeat the call. Failures, including dismissed or timed-out forms, are reported only while a turn is active; they do not start a new turn.";

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
  detachWith(response: ToolCallResponse): void;
}

const activeCall = new AsyncLocalStorage<TrackedPluginToolCall>();

function stubResponse(text: string): ToolCallResponse {
  return { success: true, contentItems: [{ type: "inputText", text }] };
}

/**
 * Called by the plugin API when a tool call asks the person for input. Core
 * answers the round trip at once with a notice that the call is waiting on
 * them, so the provider never has to hold a tool call open for a human, and
 * the eventual result reaches the agent as a message. A no-op outside a
 * plugin tool call, for instance from a CLI command.
 */
export function detachActivePluginToolCallForPerson(): void {
  activeCall
    .getStore()
    ?.detachWith(stubResponse(PLUGIN_TOOL_CALL_AWAITING_PERSON_RESULT_TEXT));
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
    let detachWith: (response: ToolCallResponse) => void = () => undefined;
    const tracked: TrackedPluginToolCall = {
      pluginId: args.pluginId,
      threadId: args.threadId,
      callId: args.callId,
      toolName: args.toolName,
      controller,
      detachWith: (response) => detachWith(response),
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
      detachWith = (response) => {
        if (settled || detached) return;
        detach();
        resolve(response);
      };
      const deadline = setTimeout(() => {
        detachWith(stubResponse(PLUGIN_TOOL_CALL_DETACHED_RESULT_TEXT));
      }, this.detachAfterMs);
      deadline.unref?.();
      args.roundTrip.addEventListener("abort", detach, { once: true });
      if (args.roundTrip.aborted) detach();

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
        invocation = activeCall.run(tracked, () =>
          args.invoke(controller.signal),
        );
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
