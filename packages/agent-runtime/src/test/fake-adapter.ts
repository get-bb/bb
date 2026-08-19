import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
  isUserQuestionPendingInteractionPayload,
  isUserQuestionPendingInteractionResolution,
  threadScope,
  threadEventItemSchema,
  turnScope,
  type ApprovalPendingInteractionPayload,
  type AvailableModel,
  type PendingInteractionUserQuestionOption,
  type ProviderCapabilities,
  type ThreadEvent,
} from "@bb/domain";
import type { AdapterCommand, ProviderAdapter } from "../provider-adapter.js";
import {
  ProviderResponseEncodeError,
  decodeNormalizedProviderToolCallRequest,
  BuildInteractiveResponseArgs,
} from "@bb/provider-bridge-protocol/bridge-kit";
import type {
  DecodedInteractiveRequest,
  DecodedToolCallRequest,
  ProviderCommandPlan,
  ProviderInboundRequest,
  ProviderInteractiveResponse,
  ProviderRuntimeEvent,
} from "@bb/provider-bridge-protocol/bridge-kit";
import {
  flattenPromptInputGroups,
  noPreparedProviderCommandDispatch,
} from "../provider-adapter.js";
import { parseAvailableModelList } from "../shared/available-models.js";
import { classifySessionExecutionSettingsChange } from "../execution-options.js";
type FakeUserQuestionCapability =
  ProviderCapabilities["supportsNativeUserQuestion"];

export interface CreateFakeProviderExecutionContext {
  displayName?: string;
  id?: string;
  scriptPath?: string;
  supportsNativeUserQuestion?: FakeUserQuestionCapability;
}

interface FakeEventMessage {
  method: string;
  params: Record<string, unknown>;
}

const DEFAULT_ADAPTER_ID = "fake";
const DEFAULT_DISPLAY_NAME = "Fake Provider";
const FAKE_USER_QUESTION_REQUEST_METHOD = "interaction/user_question";
const FAKE_APPROVAL_REQUEST_METHOD = "interaction/approval";

function resolveTsxLoaderSpecifier(): string {
  return import.meta.resolve("tsx");
}

export function buildNodeScriptArgs(scriptPath: string): string[] {
  if (scriptPath.endsWith(".ts")) {
    return [
      "--conditions=source",
      "--import",
      resolveTsxLoaderSpecifier(),
      scriptPath,
    ];
  }

  return [scriptPath];
}

function resolveFakeProviderScriptPath(): string {
  const sourceScriptPath = fileURLToPath(
    new URL("./fake-provider-script.ts", import.meta.url),
  );
  if (existsSync(sourceScriptPath)) {
    return sourceScriptPath;
  }

  throw new Error(
    "Missing fake provider script. Expected packages/agent-runtime/src/test/fake-provider-script.ts.",
  );
}

export const fakeProviderScriptPath = resolveFakeProviderScriptPath();

function buildCommandPlan(command: AdapterCommand): ProviderCommandPlan {
  switch (command.type) {
    case "initialize":
      return { kind: "request", method: "initialize", params: {} };
    case "model/list":
      return { kind: "request", method: "model/list", params: {} };
    case "skills/configure":
      return {
        kind: "request",
        method: "skills/configure",
        params: { skillRoots: command.skillRoots },
      };
    case "thread/start":
      return {
        kind: "request",
        method: "thread/start",
        params: {
          cwd: command.cwd,
          dynamicTools: command.dynamicTools,
          input: command.input,
          options: command.options,
          threadId: command.threadId,
        },
      };
    case "thread/resume":
      return {
        kind: "request",
        method: "thread/resume",
        params: {
          cwd: command.cwd,
          dynamicTools: command.dynamicTools,
          options: command.options,
          providerThreadId: command.providerThreadId,
          threadId: command.threadId,
        },
      };
    case "thread/fork":
      return {
        kind: "request",
        method: "thread/fork",
        params: {
          cwd: command.cwd,
          dynamicTools: command.dynamicTools,
          options: command.options,
          sourceProviderThreadId: command.sourceProviderThreadId,
          threadId: command.threadId,
        },
      };
    case "turn/start":
      return {
        kind: "request",
        method: "turn/start",
        params: {
          input: flattenPromptInputGroups(command.input, command.inputGroups),
          options: command.options,
          providerThreadId: command.providerThreadId,
          threadId: command.threadId,
        },
      };
    case "turn/steer":
      return {
        kind: "request",
        method: "turn/steer",
        params: {
          expectedTurnId: command.expectedTurnId,
          input: flattenPromptInputGroups(command.input, command.inputGroups),
          providerThreadId: command.providerThreadId,
          threadId: command.threadId,
        },
      };
    case "thread/stop":
      return {
        kind: "request",
        method: "thread/stop",
        params: {
          activeTurnId: command.activeTurnId,
          providerThreadId: command.providerThreadId,
          threadId: command.threadId,
        },
      };
    case "thread/discard":
      return {
        kind: "request",
        method: "thread/discard",
        params: {
          providerThreadId: command.providerThreadId,
          threadId: command.threadId,
        },
      };
    case "thread/goal/clear":
      return {
        kind: "request",
        method: "thread/goal/clear",
        params: {
          providerThreadId: command.providerThreadId,
          threadId: command.threadId,
        },
      };
    case "thread/name/set":
      return {
        kind: "request",
        method: "thread/name/set",
        params: {
          providerThreadId: command.providerThreadId,
          threadId: command.threadId,
          title: command.title,
        },
      };
    case "thread/archive":
      return {
        kind: "request",
        method: "thread/archive",
        params: {
          providerThreadId: command.providerThreadId,
          threadId: command.threadId,
        },
      };
    case "thread/unarchive":
      return {
        kind: "request",
        method: "thread/unarchive",
        params: {
          providerThreadId: command.providerThreadId,
          threadId: command.threadId,
        },
      };
    case "provider/health":
    case "provider/usage":
      return { kind: "noop", reason: `${command.type} unsupported` };
    default: {
      const _exhaustive: never = command;
      throw new Error(`Unhandled fake adapter command: ${String(_exhaustive)}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringParam(
  params: Record<string, unknown>,
  key: string,
): string | null {
  const value = params[key];
  return typeof value === "string" ? value : null;
}

function optionalStringParam(
  params: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function booleanParam(params: Record<string, unknown>, key: string): boolean {
  const value = params[key];
  return typeof value === "boolean" ? value : false;
}

function turnIdParam(
  params: Record<string, unknown>,
): string | null | undefined {
  const value = params.turnId;
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function parseFakeQuestionOptions(
  value: unknown,
): PendingInteractionUserQuestionOption[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const options: PendingInteractionUserQuestionOption[] = [];
  for (const optionValue of value) {
    if (!isRecord(optionValue)) {
      return null;
    }

    const optionValueId = stringParam(optionValue, "value");
    const label = stringParam(optionValue, "label");
    if (!optionValueId || !label) {
      return null;
    }

    const description = optionalStringParam(optionValue, "description");
    options.push(
      description
        ? { value: optionValueId, label, description }
        : { value: optionValueId, label },
    );
  }

  return options;
}

function toFakeEventMessage(
  event: ProviderRuntimeEvent,
): FakeEventMessage | null {
  if (typeof event.method !== "string" || !isRecord(event.params)) {
    return null;
  }
  return {
    method: event.method,
    params: event.params,
  };
}

function translateEventMessage(event: ProviderRuntimeEvent): ThreadEvent[] {
  const message = toFakeEventMessage(event);
  if (!message) {
    return [];
  }

  const threadId =
    typeof message.params.threadId === "string" ? message.params.threadId : "";
  const turnId =
    typeof message.params.turnId === "string" ? message.params.turnId : "";
  const providerThreadId =
    typeof message.params.providerThreadId === "string"
      ? message.params.providerThreadId
      : "";

  switch (message.method) {
    case "thread/identity":
      return [
        {
          type: "thread/identity",
          threadId,
          providerThreadId,
          scope: threadScope(),
        },
      ];
    case "turn/started":
      return [
        {
          type: "turn/started",
          threadId,
          providerThreadId,
          scope: turnScope(turnId),
        },
      ];
    case "turn/completed": {
      const status = message.params.status;
      return [
        {
          type: "turn/completed",
          threadId,
          providerThreadId,
          scope: turnScope(turnId),
          status:
            status === "failed" || status === "interrupted"
              ? status
              : "completed",
        },
      ];
    }
    case "item/started":
    case "item/completed": {
      const item = threadEventItemSchema.parse(message.params.item);
      if (item.type === "userMessage") {
        return [];
      }
      return [
        {
          type: message.method,
          threadId,
          providerThreadId,
          scope: turnScope(turnId),
          item,
        },
      ];
    }
    case "thread/name/updated":
      return [
        {
          type: "thread/name/updated",
          threadId,
          providerThreadId,
          scope: threadScope(),
          threadName:
            typeof message.params.threadName === "string"
              ? message.params.threadName
              : "",
        },
      ];
    // The runtime settles `thread/goal/clear` on this notification rather than
    // on the response, so a provider double that can drive that ordering needs
    // to translate it.
    case "thread/goal/cleared":
      return [
        {
          type: "thread/goal/cleared",
          threadId,
          providerThreadId,
          scope: threadScope(),
        },
      ];
    default:
      return [];
  }
}

function decodeToolCallRequest(
  request: ProviderInboundRequest,
): DecodedToolCallRequest | null {
  if (typeof request.id !== "string" && typeof request.id !== "number") {
    return null;
  }
  return decodeNormalizedProviderToolCallRequest(
    request.id,
    request.method,
    request.params,
  );
}

function decodeUserQuestionRequest(
  request: ProviderInboundRequest,
): DecodedInteractiveRequest | null {
  if (
    request.method !== FAKE_USER_QUESTION_REQUEST_METHOD ||
    (typeof request.id !== "string" && typeof request.id !== "number") ||
    !isRecord(request.params)
  ) {
    return null;
  }

  const providerThreadId = stringParam(request.params, "providerThreadId");
  const turnId = turnIdParam(request.params);
  const prompt = stringParam(request.params, "prompt");
  const options = parseFakeQuestionOptions(request.params.options);
  if (!providerThreadId || turnId === undefined || !prompt || !options) {
    return null;
  }

  return {
    requestId: request.id,
    method: request.method,
    providerThreadId,
    turnId,
    threadId: optionalStringParam(request.params, "threadId"),
    payload: {
      kind: "user_question",
      questions: [
        {
          id: `${String(request.id)}:question-1`,
          prompt,
          shortLabel: optionalStringParam(request.params, "shortLabel"),
          multiSelect: booleanParam(request.params, "multiSelect"),
          options,
          allowFreeText: booleanParam(request.params, "allowFreeText"),
        },
      ],
    },
  };
}

// Maps the fake script's `interaction/approval` params (`approvalKind` plus a
// few kind-specific fixture fields) onto bb's approval payload. The subject
// shape is spelled out here so a domain schema change fails typecheck instead
// of silently dropping the request at runtime.
function buildFakeApprovalPayload(
  params: Record<string, unknown>,
  itemId: string,
): ApprovalPendingInteractionPayload | null {
  const approvalKind = stringParam(params, "approvalKind");
  switch (approvalKind) {
    case "command": {
      const command = stringParam(params, "command");
      if (!command) {
        return null;
      }
      return {
        kind: "approval",
        subject: {
          kind: "command",
          itemId,
          command,
          cwd: stringParam(params, "cwd"),
          actions: [],
          sessionGrant: null,
        },
        reason: null,
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      };
    }
    case "file_change": {
      const path = stringParam(params, "path");
      if (!path) {
        return null;
      }
      return {
        kind: "approval",
        subject: {
          kind: "file_change",
          itemId,
          writeScope: null,
          sessionGrant: null,
        },
        reason: `Write ${path}`,
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      };
    }
    case "permission_grant": {
      const path = stringParam(params, "path");
      if (!path) {
        return null;
      }
      return {
        kind: "approval",
        subject: {
          kind: "permission_grant",
          itemId,
          toolName: stringParam(params, "toolName"),
          permissions: {
            network: null,
            fileSystem: { read: [], write: [path] },
          },
        },
        reason: null,
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      };
    }
    case "plan": {
      const plan = stringParam(params, "plan");
      if (!plan) {
        return null;
      }
      return {
        kind: "approval",
        subject: {
          kind: "plan",
          itemId,
          plan,
          planFilePath: null,
        },
        reason: null,
        availableDecisions: ["allow_once", "deny"],
      };
    }
    default:
      return null;
  }
}

function decodeApprovalRequest(
  request: ProviderInboundRequest,
): DecodedInteractiveRequest | null {
  if (
    request.method !== FAKE_APPROVAL_REQUEST_METHOD ||
    (typeof request.id !== "string" && typeof request.id !== "number") ||
    !isRecord(request.params)
  ) {
    return null;
  }

  const providerThreadId = stringParam(request.params, "providerThreadId");
  const turnId = turnIdParam(request.params);
  const itemId = stringParam(request.params, "itemId");
  if (!providerThreadId || turnId === undefined || !itemId) {
    return null;
  }
  const payload = buildFakeApprovalPayload(request.params, itemId);
  if (!payload) {
    return null;
  }

  return {
    requestId: request.id,
    method: request.method,
    providerThreadId,
    turnId,
    threadId: optionalStringParam(request.params, "threadId"),
    payload,
  };
}

function createDecodeInteractiveRequest(
  supportsNativeUserQuestion: FakeUserQuestionCapability,
): (request: ProviderInboundRequest) => DecodedInteractiveRequest | null {
  return (request) =>
    decodeApprovalRequest(request) ??
    (supportsNativeUserQuestion ? decodeUserQuestionRequest(request) : null);
}

function buildInteractiveResponse(
  args: BuildInteractiveResponseArgs,
): ProviderInteractiveResponse {
  const matchesPayload =
    (isApprovalPendingInteractionPayload(args.request.payload) &&
      isApprovalPendingInteractionResolution(args.resolution)) ||
    (isUserQuestionPendingInteractionPayload(args.request.payload) &&
      isUserQuestionPendingInteractionResolution(args.resolution));
  if (!matchesPayload) {
    throw new ProviderResponseEncodeError(
      "Fake provider interactive response kind does not match the request payload",
    );
  }

  return args.resolution;
}

function parseModelListResult(result: unknown): {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
} {
  return parseAvailableModelList(result);
}

export function createFakeAdapter(
  options: CreateFakeProviderExecutionContext = {},
): ProviderAdapter {
  /*
   * Fake provider input control tokens:
   * - `delay:<ms>` delays turn completion by the requested duration.
   * - `call_tool:<name>` emits a provider-scoped tool call with required
   *   `providerThreadId` and no BB `threadId` hint.
   * - `call_tool_unresolved:<name>` emits the same tool call with a null
   *   `turnId`, matching the canonical bridge wire form for providers that
   *   cannot resolve the BB turn id.
   * - `ask_user` emits a provider-scoped user-question interactive request
   *   when the adapter is configured with `supportsNativeUserQuestion: true`.
   * - `approve:<kind>` (kind: `command` | `file_change` | `permission_grant`
   *   | `plan`) emits a provider-scoped approval interactive request with
   *   fixed fixture fields (`echo hi`, `src/example.ts`, ...). The turn
   *   resumes once the approval resolves: allow_once/allow_for_session echo
   *   `Response to: ...`, deny completes with `Denied`.
   * - remaining text is echoed back as `Response to: ...`.
   */
  const supportsNativeUserQuestion =
    options.supportsNativeUserQuestion ?? false;

  return {
    approvalEnforcedBy: "runtime",
    buildCommandPlan,
    capabilities: {
      supportsThreadArchive: true,
      supportsThreadRename: true,
      supportsServiceTier: false,
      supportsNativeUserQuestion,
      supportsFork: true,
      supportsSessionRewind: true,
      permissionModes: ["accept-edits", "auto", "full"],
    },
    classifyExecutionSettingsChange: classifySessionExecutionSettingsChange,
    decodeToolCallRequest,
    decodeInteractiveRequest: createDecodeInteractiveRequest(
      supportsNativeUserQuestion,
    ),
    displayName: options.displayName ?? DEFAULT_DISPLAY_NAME,
    id: options.id ?? DEFAULT_ADAPTER_ID,
    parseModelListResult,
    prepareTurnStart: noPreparedProviderCommandDispatch,
    process: {
      args: buildNodeScriptArgs(options.scriptPath ?? fakeProviderScriptPath),
      command: "node",
    },
    translateEvent(event) {
      return translateEventMessage(event);
    },
    translateAcceptedCommand() {
      return [];
    },
    buildInteractiveResponse,
  };
}
