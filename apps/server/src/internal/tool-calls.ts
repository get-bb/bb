import {
  hostDaemonToolCallRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { ToolCallResponse } from "@bb/domain";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { requireThreadEnvironment } from "../services/lib/entity-lookup.js";
import {
  findPluginAgentTool,
  invokePluginAgentTool,
} from "../services/plugins/plugin-agent-contributions.js";
import {
  handleUpdateEnvironmentDirectoryToolCall,
  UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME,
} from "../services/threads/thread-environment-directory.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";

const textEncoder = new TextEncoder();

/**
 * Return the response head before a plugin tool finishes. Interactive plugin
 * tools can wait for user input for minutes, while bb Connect requires an
 * origin response head within 30 seconds. The response body can stay open.
 */
function streamToolCallResponse(result: Promise<ToolCallResponse>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void result.then(
        (response) => {
          try {
            controller.enqueue(textEncoder.encode(JSON.stringify(response)));
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
        (error) => controller.error(error),
      );
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
}

export function registerInternalToolCallRoutes(
  app: Hono,
  deps: AppDeps,
  plugins: PluginService,
): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(
    "/session/tool-call",
    hostDaemonToolCallRequestSchema,
    async (context, payload) => {
      const session = requireAuthenticatedDaemonSession({
        context,
        db: deps.db,
        sessionId: payload.sessionId,
      });
      const { environment, thread } = requireThreadEnvironment(
        deps.db,
        payload.threadId,
      );
      if (environment.hostId !== session.hostId) {
        throw new ApiError(
          403,
          "invalid_request",
          "Thread does not belong to the session host",
        );
      }

      // Built-in tools win name lookups; then the native plugin-tool
      // registry (bb.agents.registerTool). A tool whose plugin was
      // disabled/reloaded away since the session started falls through to
      // the unsupported-tool response below.
      let invokeTool: (() => Promise<ToolCallResponse>) | undefined;
      if (payload.tool === UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME) {
        invokeTool = () =>
          handleUpdateEnvironmentDirectoryToolCall(deps, {
            currentEnvironment: environment,
            input: payload.arguments,
            thread,
            turnId: payload.turnId,
          });
      } else {
        const pluginTool = findPluginAgentTool(payload.tool);
        if (pluginTool) {
          invokeTool = () =>
            invokePluginAgentTool(pluginTool, {
              input: payload.arguments,
              ctx: {
                threadId: thread.id,
                projectId: thread.projectId,
                // The request's own abort signal: it fires if the daemon
                // round-trip is torn down while the tool runs.
                signal: context.req.raw.signal,
              },
            });
        }
      }

      if (!invokeTool) {
        return context.json({
          success: false,
          contentItems: [
            { type: "inputText", text: `Unsupported tool: ${payload.tool}` },
          ],
        });
      }

      return streamToolCallResponse(
        (async () => {
          const decision = await plugins.runBeforeInvocation({
            kind: "agent-tool",
            name: payload.tool,
            input: payload.arguments,
            threadId: thread.id,
            projectId: thread.projectId,
            signal: context.req.raw.signal,
          });
          if (!decision.allowed) {
            return {
              success: false,
              contentItems: [
                {
                  type: "inputText",
                  text: `Invocation blocked: ${decision.reason}`,
                },
              ],
            };
          }
          try {
            return await invokeTool();
          } catch (error) {
            // The response head is already out: a throw here would tear the
            // stream instead of reaching the daemon as an error. Report it
            // as the tool's failure and keep the server's own log of it.
            const message = error instanceof Error ? error.message : String(error);
            deps.logger.error(
              { err: error, tool: payload.tool, threadId: thread.id },
              "agent tool call failed",
            );
            return {
              success: false,
              contentItems: [{ type: "inputText", text: `Tool failed: ${message}` }],
            };
          }
        })(),
      );
    },
  );
}
