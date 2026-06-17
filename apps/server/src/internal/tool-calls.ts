import {
  hostDaemonToolCallRequestSchema,
  typedRoutes,
  type HostDaemonToolCallResponse,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { requireThreadEnvironment } from "../services/lib/entity-lookup.js";
import {
  SIDE_CHAT_SEND_TO_MAIN_THREAD_TOOL_NAME,
  isSideChatThread,
  sideChatSendToMainThreadToolArgumentsSchema,
} from "../services/threads/side-chat-main-thread-tool.js";
import { sendThreadMessage } from "../services/threads/thread-send.js";
import { requireAuthenticatedDaemonSession } from "./session-state.js";

function textToolResponse(
  success: boolean,
  text: string,
): HostDaemonToolCallResponse {
  return {
    success,
    contentItems: [{ type: "inputText", text }],
  };
}

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

      if (payload.tool === SIDE_CHAT_SEND_TO_MAIN_THREAD_TOOL_NAME) {
        if (!isSideChatThread(thread) || thread.sourceThreadId === null) {
          return context.json(
            textToolResponse(
              false,
              "This tool is only available in side chat threads.",
            ),
          );
        }

        const parsedArguments =
          sideChatSendToMainThreadToolArgumentsSchema.safeParse(
            payload.arguments,
          );
        if (!parsedArguments.success) {
          return context.json(
            textToolResponse(
              false,
              "Provide a non-empty message to send to the main thread.",
            ),
          );
        }

        const target = requireThreadEnvironment(deps.db, thread.sourceThreadId);
        if (target.environment.hostId !== session.hostId) {
          throw new ApiError(
            403,
            "invalid_request",
            "Target thread does not belong to the session host",
          );
        }

        await sendThreadMessage(deps, {
          environment: target.environment,
          thread: target.thread,
          payload: {
            input: [
              {
                type: "text",
                text: parsedArguments.data.message,
                mentions: [],
              },
            ],
            mode: "auto",
            senderThreadId: thread.id,
          },
          trigger: "user",
        });

        return context.json(textToolResponse(true, "Sent to main thread."));
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
