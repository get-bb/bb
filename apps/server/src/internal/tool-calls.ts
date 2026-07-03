import {
  hostDaemonToolCallRequestSchema,
  typedRoutes,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
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

export function registerInternalToolCallRoutes(app: Hono, deps: AppDeps): void {
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
      if (payload.tool === UPDATE_ENVIRONMENT_DIRECTORY_TOOL_NAME) {
        return context.json(
          await handleUpdateEnvironmentDirectoryToolCall(deps, {
            currentEnvironment: environment,
            input: payload.arguments,
            thread,
            turnId: payload.turnId,
          }),
        );
      }

      const pluginTool = findPluginAgentTool(payload.tool);
      if (pluginTool) {
        return context.json(
          await invokePluginAgentTool(pluginTool, {
            input: payload.arguments,
            ctx: {
              threadId: thread.id,
              projectId: thread.projectId,
              // The request's own abort signal: it fires if the daemon
              // round-trip is torn down while the tool runs.
              signal: context.req.raw.signal,
            },
          }),
        );
      }

      return context.json({
        success: false,
        contentItems: [
          { type: "inputText", text: `Unsupported tool: ${payload.tool}` },
        ],
      });
    },
  );
}
