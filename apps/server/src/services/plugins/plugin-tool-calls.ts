import { AsyncLocalStorage } from "node:async_hooks";
import type { ToolCallResponse } from "@bb/domain";
import type { ServerLogger } from "../../types.js";

export const PLUGIN_TOOL_CALL_AWAITING_USER_RESULT_TEXT =
  "The request is shown to the user. A successful result will arrive separately. Do not ask again or assume an answer. Continue independent work; if blocked, briefly say what you are waiting for and end your turn.";

export interface RunPluginToolCallArgs {
  pluginId: string;
  threadId: string;
  callId: string;
  toolName: string;
  roundTrip: AbortSignal;
  invoke(signal: AbortSignal): Promise<ToolCallResponse>;
  onDetachedResult(result: DetachedPluginToolResult): Promise<void>;
}

export interface DetachedPluginToolResult {
  response: ToolCallResponse;
  wakeIdleThread: boolean;
}

type PluginToolCallAbandonment = "plugin" | "thread";

interface TrackedPluginToolCall {
  pluginId: string;
  threadId: string;
  callId: string;
  toolName: string;
  abandon(by: PluginToolCallAbandonment, reason: string): void;
  detachWith(response: ToolCallResponse): void;
}

const activeCall = new AsyncLocalStorage<TrackedPluginToolCall>();

function stubResponse(text: string): ToolCallResponse {
  return { success: true, contentItems: [{ type: "inputText", text }] };
}

export function detachActivePluginToolCallForUserInput(): void {
  activeCall
    .getStore()
    ?.detachWith(stubResponse(PLUGIN_TOOL_CALL_AWAITING_USER_RESULT_TEXT));
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

function pluginStoppedError(pluginId: string): Error {
  return new Error(
    `the "${pluginId}" plugin stopped before the call finished (it was reloaded, updated or disabled), so its result will not arrive. Call the tool again if you still need it.`,
  );
}

export class PluginToolCallRegistry {
  private readonly calls = new Set<TrackedPluginToolCall>();
  private readonly logger: ServerLogger;

  constructor(args: { logger: ServerLogger }) {
    this.logger = args.logger;
  }

  run(args: RunPluginToolCallArgs): Promise<ToolCallResponse> {
    const controller = new AbortController();
    let detachWith: (response: ToolCallResponse) => void = () => undefined;
    let abandon: (by: PluginToolCallAbandonment, reason: string) => void = () =>
      undefined;
    const tracked: TrackedPluginToolCall = {
      pluginId: args.pluginId,
      threadId: args.threadId,
      callId: args.callId,
      toolName: args.toolName,
      abandon: (by, reason) => abandon(by, reason),
      detachWith: (response) => detachWith(response),
    };
    this.calls.add(tracked);

    return new Promise<ToolCallResponse>((resolve) => {
      let detached = false;
      let settled = false;
      const abortRoundTrip = () => {
        controller.abort(args.roundTrip.reason);
        settle(failedToolCallResponse(args.toolName, args.roundTrip.reason));
      };
      detachWith = (response) => {
        if (settled || detached || controller.signal.aborted) return;
        detached = true;
        args.roundTrip.removeEventListener("abort", abortRoundTrip);
        resolve(response);
      };

      const deliverDetached = (result: DetachedPluginToolResult) => {
        void args.onDetachedResult(result).catch((error: unknown) => {
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

      const finish = (): boolean => {
        if (settled) return false;
        settled = true;
        args.roundTrip.removeEventListener("abort", abortRoundTrip);
        this.calls.delete(tracked);
        return true;
      };

      const settle = (response: ToolCallResponse) => {
        if (!finish()) return;
        if (!detached) {
          resolve(response);
          return;
        }
        deliverDetached({ response, wakeIdleThread: false });
      };

      abandon = (by, reason) => {
        if (settled) return;
        controller.abort(reason);
        const response =
          by === "plugin"
            ? failedToolCallResponse(
                args.toolName,
                pluginStoppedError(args.pluginId),
              )
            : failedToolCallResponse(args.toolName, reason);
        if (!finish()) return;
        if (!detached) {
          resolve(response);
          return;
        }
        if (by === "plugin") {
          deliverDetached({ response, wakeIdleThread: true });
          return;
        }
        this.logger.info(
          {
            threadId: args.threadId,
            callId: args.callId,
            tool: args.toolName,
            reason,
          },
          "Dropped a detached plugin tool result after its thread went away",
        );
      };

      args.roundTrip.addEventListener("abort", abortRoundTrip, { once: true });
      if (args.roundTrip.aborted) {
        abortRoundTrip();
        return;
      }

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
    for (const call of [...this.calls]) {
      if (ids.has(call.threadId)) call.abandon("thread", reason);
    }
  }

  abortForPlugin(pluginId: string, reason: string): void {
    for (const call of [...this.calls]) {
      if (call.pluginId === pluginId) call.abandon("plugin", reason);
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
