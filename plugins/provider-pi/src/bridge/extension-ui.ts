import {
  PLUGIN_INTERACTION_MAX_TITLE_LENGTH,
  experimental_unansweredInteractionWarning,
  type ThreadDelta,
  type UnansweredInteractionCause,
} from "@get-bb/plugin-sdk/provider-bridge";
import type { z } from "zod";
import {
  PI_EXTENSION_UI_KIND,
  piExtensionUiPayloadDataSchema,
  piExtensionUiRequestSchema,
  piExtensionUiResolutionSchema,
  resolveExtensionUiResponseFields,
  type InteractionUiRequest,
  type PiExtensionUiRequest,
  type PiExtensionUiResponseFields,
  type RuntimeInteractionUiResponse,
} from "../extension-ui-contract.js";

const FIRE_AND_FORGET_METHODS = new Set([
  "notify",
  "setStatus",
  "setWidget",
  "setTitle",
  "set_editor_text",
]);

interface PendingExtensionUiRequest {
  scope: object;
  threadId: string;
  request: PiExtensionUiRequest;
  expiry: ReturnType<typeof setTimeout> | null;
  respond: (
    requestId: string | number,
    fields: PiExtensionUiResponseFields,
  ) => void;
}

export interface ExtensionUiCoordinatorOptions {
  sendInteractionRequest: (request: InteractionUiRequest) => void;
  sendThreadDeltas: (threadId: string, deltas: ThreadDelta[]) => void;
  sendRequestCancelled: (interactionId: string) => void;
}

export interface HandleExtensionUiRequestArgs {
  scope: object;
  request: Record<string, unknown>;
  threadId: string;
  providerThreadId: string;
  respond: (
    requestId: string | number,
    fields: PiExtensionUiResponseFields,
  ) => void;
}

export interface ExtensionUiCoordinator {
  handle(args: HandleExtensionUiRequestArgs): void;
  handleRuntimeResponse(response: RuntimeInteractionUiResponse): boolean;
  cancelPendingForScope(scope: object): void;
}

function rawMethod(request: Record<string, unknown>): unknown {
  return request.method;
}

function rawId(request: Record<string, unknown>): string | number | null {
  const id = request.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function cardTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= PLUGIN_INTERACTION_MAX_TITLE_LENGTH) {
    return trimmed;
  }
  let shortened = "";
  for (const codePoint of trimmed) {
    if (
      shortened.length + codePoint.length >
      PLUGIN_INTERACTION_MAX_TITLE_LENGTH - 1
    ) {
      break;
    }
    shortened += codePoint;
  }
  return `${shortened.trimEnd()}…`;
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "the dialog request is invalid";
  const path = issue.path.join(".");
  return path === "" ? issue.message : `${path}: ${issue.message}`;
}

export function createExtensionUiCoordinator(
  options: ExtensionUiCoordinatorOptions,
): ExtensionUiCoordinator {
  const pending = new Map<string, PendingExtensionUiRequest>();
  let nextRequestId = 0;

  function cancelWithoutUser(args: {
    threadId: string;
    requestId: string | number;
    respond: PendingExtensionUiRequest["respond"];
    cause: UnansweredInteractionCause;
  }): void {
    options.sendThreadDeltas(args.threadId, [
      experimental_unansweredInteractionWarning({
        cause: args.cause,
        answer: { kind: "value", value: "cancelled" },
      }),
    ]);
    args.respond(args.requestId, { cancelled: true });
  }

  const take = (interactionId: string): PendingExtensionUiRequest | null => {
    const entry = pending.get(interactionId);
    if (!entry) {
      return null;
    }
    pending.delete(interactionId);
    if (entry.expiry !== null) {
      clearTimeout(entry.expiry);
    }
    return entry;
  };

  const withdraw = (
    interactionId: string,
  ): PendingExtensionUiRequest | null => {
    const entry = take(interactionId);
    if (entry) {
      options.sendRequestCancelled(interactionId);
    }
    return entry;
  };

  return {
    handle(args) {
      if (FIRE_AND_FORGET_METHODS.has(String(rawMethod(args.request)))) {
        return;
      }
      const parsed = piExtensionUiRequestSchema.safeParse(args.request);
      if (!parsed.success) {
        const id = rawId(args.request);
        if (id !== null) {
          cancelWithoutUser({
            threadId: args.threadId,
            requestId: id,
            respond: args.respond,
            cause: {
              kind: "unshowable-request",
              detail: firstIssue(parsed.error),
            },
          });
        }
        return;
      }
      const request: PiExtensionUiRequest = parsed.data;
      const title = cardTitle(request.title);
      const data = piExtensionUiPayloadDataSchema.parse({
        requestId: String(request.id),
        ...(title === request.title.trim() ? {} : { fullTitle: request.title }),
        method: request.method,
        ...(request.options ? { options: request.options } : {}),
        ...(request.message !== undefined ? { message: request.message } : {}),
        ...(request.placeholder !== undefined
          ? { placeholder: request.placeholder }
          : {}),
        ...(request.prefill !== undefined ? { prefill: request.prefill } : {}),
      });
      nextRequestId += 1;
      const interactionId = `pi-ui-${nextRequestId}`;
      pending.set(interactionId, {
        scope: args.scope,
        threadId: args.threadId,
        request,
        expiry:
          request.timeout === undefined
            ? null
            : setTimeout(() => withdraw(interactionId), request.timeout),
        respond: args.respond,
      });
      try {
        options.sendInteractionRequest({
          jsonrpc: "2.0",
          id: interactionId,
          method: "interaction/request",
          params: {
            providerThreadId: args.providerThreadId,
            threadId: args.threadId,
            turnId: null,
            payload: {
              kind: PI_EXTENSION_UI_KIND,
              title,
              data,
            },
          },
        });
      } catch (error) {
        take(interactionId);
        cancelWithoutUser({
          threadId: args.threadId,
          requestId: request.id,
          respond: args.respond,
          cause: {
            kind: "runtime-error",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },

    handleRuntimeResponse(response) {
      const entry = take(String(response.id));
      if (!entry) {
        return false;
      }
      const unanswered = {
        threadId: entry.threadId,
        requestId: entry.request.id,
        respond: entry.respond,
      };
      if (response.error !== undefined) {
        cancelWithoutUser({
          ...unanswered,
          cause: {
            kind: "runtime-error",
            message: response.error.message ?? "the interaction failed",
          },
        });
        return true;
      }
      const parsed = piExtensionUiResolutionSchema.safeParse(response.result);
      if (!parsed.success) {
        cancelWithoutUser({
          ...unanswered,
          cause: { kind: "unreadable-resolution" },
        });
        return true;
      }
      const fields = resolveExtensionUiResponseFields(
        entry.request,
        parsed.data,
      );
      if ("unmappable" in fields) {
        cancelWithoutUser({
          ...unanswered,
          cause: { kind: "unmappable-answer", detail: fields.unmappable },
        });
        return true;
      }
      entry.respond(entry.request.id, fields);
      return true;
    },

    cancelPendingForScope(scope) {
      for (const [interactionId, entry] of [...pending]) {
        if (entry.scope !== scope) {
          continue;
        }
        withdraw(interactionId);
        entry.respond(entry.request.id, { cancelled: true });
      }
    },
  };
}
