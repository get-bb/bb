/**
 * Codex provider adapter.
 *
 * Maps between bb's ProviderAdapter contract and the OpenAI Codex app-server
 * JSON-RPC protocol. Validates the outer JSON-RPC envelope before translating
 * the provider-specific payloads. Parameter building lives in
 * `session-params.ts` and the stateful translation pipeline in
 * `translator.ts`; both are shared verbatim with the canonical codex bridge.
 *
 * Reference: https://github.com/openai/codex (codex-rs/app-server-protocol/)
 */

import { getBuiltInAgentProviderInfo } from "@bb/agent-providers";
import { isStandaloneBuiltinCompactCommand } from "@bb/domain";
import type { ServerNotification as CodexServerNotification } from "./generated/codex-app-server/schema/ServerNotification.js";
import type { ThreadCompactStartParams } from "./generated/codex-app-server/schema/v2/ThreadCompactStartParams.js";
import type { ThreadResumeParams } from "./generated/codex-app-server/schema/v2/ThreadResumeParams.js";
import { parseModelsResponse } from "./models.js";
import { createStandardAdapterMembers } from "../shared/standard-adapter-members.js";
import type {
  ProviderAdapter,
  ProviderAdapterFactoryOptions,
} from "../provider-adapter.js";
import { flattenPromptInputGroups } from "../provider-adapter.js";
import { classifySessionExecutionSettingsChange } from "../execution-options.js";
import type { ProviderRuntimeEvent } from "../runtime-json-rpc.js";
import {
  buildCodexInteractiveResponse,
  decodeCodexInteractiveRequest,
} from "./interactive-requests.js";
import {
  codexSkillRootPath,
  resolveCodexInstructionOverrides,
  toCodexDynamicTools,
  toCodexPermissionSettings,
  toCodexServiceTier,
  toCodexUserInput,
  type BbThreadForkParams,
  type BbThreadStartParams,
  type CodexSkillsExtraRootsSetParams,
} from "./session-params.js";
import { createCodexEventTranslator } from "./translator.js";

export type CodexEvent = CodexServerNotification;

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export interface CreateCodexProviderAdapterOptions extends ProviderAdapterFactoryOptions {
  processCommand?: string;
  processArgs?: string[];
}

export function createCodexProviderAdapter(
  opts?: CreateCodexProviderAdapterOptions,
): ProviderAdapter {
  const additionalWorkspaceWriteRoots =
    opts?.additionalWorkspaceWriteRoots ?? [];
  const providerInfo = getBuiltInAgentProviderInfo("codex");
  const capabilities = providerInfo.capabilities;
  const translator = createCodexEventTranslator({
    additionalWorkspaceWriteRoots,
  });

  const standardAdapterMembers = createStandardAdapterMembers({
    id: providerInfo.id,
    displayName: providerInfo.displayName,
    capabilities,
    approvalRequestPolicy: "runtime",
    classifyExecutionSettingsChange: classifySessionExecutionSettingsChange,
    // Codex app-server connections are owned by the runtime process manager.
    // BB runs live Codex threads on thread-scoped app-server processes, while
    // provider-only probes can still use a provider-scoped maintenance process.
    process: {
      command: opts?.processCommand ?? "codex",
      args: opts?.processArgs ?? ["app-server"],
    },
    initializeParams: {
      clientInfo: { name: "bb", version: "1.0.0", title: null },
      capabilities: { experimentalApi: true },
    },
    codec: "native",
    buildProviderCommandPlan(command) {
      switch (command.type) {
        case "model/list":
          return {
            kind: "request",
            method: "model/list",
            params: {},
          };
        case "skills/configure": {
          const params: CodexSkillsExtraRootsSetParams = {
            extraRoots: command.skillRoots.map((skillRoot) =>
              codexSkillRootPath({ skillRoot }),
            ),
          };
          return {
            kind: "request",
            method: "skills/extraRoots/set",
            params,
          };
        }
        case "thread/start": {
          const dynamicTools = toCodexDynamicTools(command.dynamicTools);
          const preparedGitRoots = translator.prepareWorkspaceWriteGitRoots({
            command,
          });
          const params: BbThreadStartParams = {
            approvalPolicy: preparedGitRoots.permissionSettings.approvalPolicy,
            approvalsReviewer:
              preparedGitRoots.permissionSettings.approvalsReviewer,
            sandbox: preparedGitRoots.permissionSettings.sandbox,
            cwd: command.cwd,
            ...resolveCodexInstructionOverrides(command),
            model: command.options?.model ?? undefined,
            serviceTier: toCodexServiceTier(command.options?.serviceTier),
            // bb reaps idle thread-scoped Codex processes and later resumes by
            // provider thread id, so the rollout must exist on disk. Codex
            // already defaults to non-ephemeral; pin the value so a future
            // default flip cannot silently break resume.
            ephemeral: false,
            config: preparedGitRoots.config ?? undefined,
            // Codex only exposes raw Responses items as a thread/start opt-in.
            experimentalRawEvents: true,
            ...(dynamicTools && dynamicTools.length > 0
              ? { dynamicTools }
              : {}),
          };
          return {
            kind: "request",
            method: "thread/start",
            params,
          };
        }
        case "thread/resume": {
          const dynamicTools = toCodexDynamicTools(command.dynamicTools);
          const preparedGitRoots = translator.prepareWorkspaceWriteGitRoots({
            command,
          });
          const params: ThreadResumeParams = {
            threadId: command.providerThreadId,
            approvalPolicy: preparedGitRoots.permissionSettings.approvalPolicy,
            approvalsReviewer:
              preparedGitRoots.permissionSettings.approvalsReviewer,
            sandbox: preparedGitRoots.permissionSettings.sandbox,
            cwd: command.cwd,
            ...resolveCodexInstructionOverrides(command),
            model: command.options?.model ?? undefined,
            serviceTier: toCodexServiceTier(command.options?.serviceTier),
            config: preparedGitRoots.config ?? undefined,
            ...(dynamicTools && dynamicTools.length > 0
              ? { dynamicTools }
              : {}),
          };
          return {
            kind: "request",
            method: "thread/resume",
            params,
          };
        }
        case "thread/fork": {
          const dynamicTools = toCodexDynamicTools(command.dynamicTools);
          const preparedGitRoots = translator.prepareWorkspaceWriteGitRoots({
            command,
          });
          const params: BbThreadForkParams = {
            threadId: command.sourceProviderThreadId,
            ...(command.sourceProviderCheckpointId !== undefined
              ? { lastTurnId: command.sourceProviderCheckpointId }
              : {}),
            approvalPolicy: preparedGitRoots.permissionSettings.approvalPolicy,
            approvalsReviewer:
              preparedGitRoots.permissionSettings.approvalsReviewer,
            sandbox: preparedGitRoots.permissionSettings.sandbox,
            cwd: command.cwd,
            ...resolveCodexInstructionOverrides(command),
            model: command.options?.model ?? undefined,
            serviceTier: toCodexServiceTier(command.options?.serviceTier),
            config: preparedGitRoots.config ?? undefined,
            ...(dynamicTools && dynamicTools.length > 0
              ? { dynamicTools }
              : {}),
          };
          return {
            kind: "request",
            method: "thread/fork",
            params,
          };
        }
        case "turn/start": {
          const input = flattenPromptInputGroups(
            command.input,
            command.inputGroups,
          );
          if (isStandaloneBuiltinCompactCommand(input)) {
            const params: ThreadCompactStartParams = {
              threadId: command.providerThreadId,
            };
            return {
              kind: "request",
              method: "thread/compact/start",
              params,
            };
          }
          const writableRoots = translator.getThreadGitWritableRoots(
            command.threadId,
          );
          const permissionSettings = toCodexPermissionSettings({
            additionalWorkspaceWriteRoots,
            gitWritableRoots: writableRoots,
            options: command.options,
          });
          return {
            kind: "request",
            method: "turn/start",
            params: {
              threadId: command.providerThreadId,
              input: toCodexUserInput(input),
              approvalPolicy: permissionSettings.approvalPolicy,
              approvalsReviewer: permissionSettings.approvalsReviewer,
              sandboxPolicy: permissionSettings.sandboxPolicy,
              model: command.options?.model ?? undefined,
              serviceTier: toCodexServiceTier(command.options?.serviceTier),
            },
          };
        }
        case "turn/steer":
          return {
            kind: "request",
            method: "turn/steer",
            params: {
              threadId: command.providerThreadId,
              expectedTurnId: command.expectedTurnId,
              input: toCodexUserInput(
                flattenPromptInputGroups(command.input, command.inputGroups),
              ),
            },
          };
        case "thread/name/set":
          if (!capabilities.supportsRename) {
            return { kind: "noop", reason: "rename unsupported" };
          }
          return {
            kind: "request",
            method: "thread/name/set",
            params: {
              threadId: command.providerThreadId,
              name: command.title,
            },
          };
        case "thread/archive":
          if (!capabilities.supportsArchive) {
            return { kind: "noop", reason: "archive unsupported" };
          }
          return {
            kind: "request",
            method: "thread/archive",
            params: {
              threadId: command.providerThreadId,
            },
          };
        case "thread/unarchive":
          if (!capabilities.supportsArchive) {
            return { kind: "noop", reason: "archive unsupported" };
          }
          return {
            kind: "request",
            method: "thread/unarchive",
            params: {
              threadId: command.providerThreadId,
            },
          };
        case "thread/stop":
          if (command.activeTurnId === null) {
            return { kind: "noop", reason: "no active turn to interrupt" };
          }
          return {
            kind: "request",
            method: "turn/interrupt",
            params: {
              threadId: command.providerThreadId,
              turnId: command.activeTurnId,
            },
          };
        case "thread/discard":
          if (!capabilities.supportsArchive) {
            return { kind: "noop", reason: "archive unsupported" };
          }
          return {
            kind: "request",
            method: "thread/archive",
            params: { threadId: command.providerThreadId },
          };
        case "thread/goal/clear":
          return {
            kind: "request",
            method: "thread/goal/clear",
            params: { threadId: command.providerThreadId },
          };
      }
    },

    prepareTurnStart(command) {
      return translator.prepareTurnStart({
        clientRequestId: command.clientRequestId,
        providerThreadId: command.providerThreadId,
      });
    },

    translateEvent(event: ProviderRuntimeEvent) {
      return translator.translateEvent(event);
    },

    onSessionReplace({ command, providerThreadId }) {
      if (providerThreadId) {
        translator.activateThreadGitWritableRoots({
          providerThreadId,
          threadId: command.threadId,
        });
      }
      return [];
    },

    parseModelListResult(result: unknown) {
      // Codex's upstream API only exposes an active model list; legacy/retired
      // models aren't surfaced separately, so selectedOnlyModels is always empty.
      return {
        models: parseModelsResponse(result),
        selectedOnlyModels: [],
      };
    },
  });

  return {
    ...standardAdapterMembers,
    hasOpenThreadWork({ providerThreadId }: { providerThreadId: string }) {
      return translator.hasOpenThreadWork({ providerThreadId });
    },
    buildPostInitializeRequests: translator.buildPostInitializeRequests,
    decodeInteractiveRequest(request) {
      return decodeCodexInteractiveRequest(request);
    },
    buildInteractiveResponse(args) {
      return buildCodexInteractiveResponse(args);
    },
  };
}
