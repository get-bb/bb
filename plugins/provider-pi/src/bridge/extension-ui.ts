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
  request: PiExtensionUiRequest;
  respond: (
    requestId: string | number,
    fields: PiExtensionUiResponseFields,
  ) => void;
}

export interface ExtensionUiCoordinatorOptions {
  sendInteractionRequest: (request: InteractionUiRequest) => void;
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

export function createExtensionUiCoordinator(
  options: ExtensionUiCoordinatorOptions,
): ExtensionUiCoordinator {
  const pending = new Map<string, PendingExtensionUiRequest>();
  let nextRequestId = 0;

  return {
    handle(args) {
      if (FIRE_AND_FORGET_METHODS.has(String(rawMethod(args.request)))) {
        return;
      }
      const parsed = piExtensionUiRequestSchema.safeParse(args.request);
      if (!parsed.success) {
        const id = rawId(args.request);
        if (id !== null) {
          args.respond(id, { cancelled: true });
        }
        return;
      }
      const request: PiExtensionUiRequest = parsed.data;
      const data = piExtensionUiPayloadDataSchema.parse({
        requestId: String(request.id),
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
        request,
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
              title: request.title,
              data,
            },
          },
        });
      } catch {
        pending.delete(interactionId);
        args.respond(request.id, { cancelled: true });
      }
    },

    handleRuntimeResponse(response) {
      const entry = pending.get(String(response.id));
      if (!entry) {
        return false;
      }
      pending.delete(String(response.id));
      const parsed = piExtensionUiResolutionSchema.safeParse(response.result);
      entry.respond(
        entry.request.id,
        parsed.success
          ? resolveExtensionUiResponseFields(entry.request, parsed.data)
          : { cancelled: true },
      );
      return true;
    },

    cancelPendingForScope(scope) {
      for (const [interactionId, entry] of pending) {
        if (entry.scope !== scope) {
          continue;
        }
        pending.delete(interactionId);
        entry.respond(entry.request.id, { cancelled: true });
      }
    },
  };
}
