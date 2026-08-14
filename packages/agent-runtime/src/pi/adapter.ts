/**
 * Pi provider adapter.
 *
 * Maps between bb's ProviderAdapter contract and the Pi coding agent bridge
 * process. The bridge owns provider SDK interactions such as model discovery.
 * Event translation lives in `./event-translation.ts` (shared with the
 * bridge's canonical Provider Bridge Protocol surface); the adapter delegates
 * to one translator instance and owns only command-plan construction.
 */

import { getBuiltInAgentProviderInfo } from "@bb/agent-providers";
import { isStandaloneBuiltinCompactCommand } from "@bb/domain";
import { resolveBridgeProcessArgs } from "../shared/bridge-path.js";
import { createStandardAdapterMembers } from "../shared/standard-adapter-members.js";
import { classifySessionExecutionSettingsChange } from "../execution-options.js";
import { finishOpenProviderTurn } from "../shared/turn-state.js";
import type {
  AdapterCommand,
  ProviderAdapter,
  ProviderExecutionContext,
} from "../provider-adapter.js";
import { flattenPromptInputGroups } from "../provider-adapter.js";
import type { AgentRuntimeSkillRoot } from "../types.js";
import {
  createPiEventTranslator,
  resetPiCommandOutputSnapshots,
  type PiModelContextWindowResolver,
} from "./event-translation.js";
import { buildPiConfig, toPiThinkingLevel } from "./session-params.js";

export { createPiModelContextWindowResolverFrom } from "./event-translation.js";

// ---------------------------------------------------------------------------
// Pi command types
// ---------------------------------------------------------------------------

type PiInstructionCommand = Extract<
  AdapterCommand,
  { type: "thread/start" | "thread/resume" | "thread/fork" }
>;

interface PiInstructionOverrides {
  baseInstructions?: string;
  appendSystemPrompt?: string;
}

function resolvePiInstructionOverrides(
  command: PiInstructionCommand,
): PiInstructionOverrides {
  const instructions = command.options.instructions?.trim();
  if (!instructions) {
    return {};
  }

  if (command.instructionMode === "replace") {
    return { baseInstructions: instructions };
  }

  return { appendSystemPrompt: instructions };
}

interface PiAdditionalSkillPathsParams {
  additionalSkillPaths: string[];
}

interface PiSkillRootPathArgs {
  skillRoot: AgentRuntimeSkillRoot;
}

function piSkillRootPath(args: PiSkillRootPathArgs): string {
  if (args.skillRoot.providerId !== "pi") {
    throw new Error(
      `Pi cannot configure ${args.skillRoot.providerId} skill root "${args.skillRoot.id}".`,
    );
  }
  return args.skillRoot.skillDirectoryRootPath;
}

function buildPiAdditionalSkillPathsParams(
  skillRoots: ProviderExecutionContext["skillRoots"],
): PiAdditionalSkillPathsParams | undefined {
  return skillRoots && skillRoots.length > 0
    ? {
        additionalSkillPaths: skillRoots.map((skillRoot) =>
          piSkillRootPath({ skillRoot }),
        ),
      }
    : undefined;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export interface CreatePiProviderAdapterOptions {
  /** Override the directory containing bundled bridge files. */
  bridgeBundleDir?: string;
  /** Optional environment values needed by the Node runtime that launches the bridge. */
  bridgeNodeEnv?: Record<string, string>;
  /** Optional executable used to run the Node bridge process. */
  bridgeNodeExecutablePath?: string;
  /** Override context-window resolution. Used by unit tests to avoid real catalogs. */
  resolveModelContextWindow?: PiModelContextWindowResolver;
  /** Prefix for bb-owned turn ids emitted by this adapter instance. */
  turnIdPrefix?: string;
}

export function createPiProviderAdapter(
  opts?: CreatePiProviderAdapterOptions,
): ProviderAdapter {
  const providerInfo = getBuiltInAgentProviderInfo("pi");
  const capabilities = providerInfo.capabilities;

  const { translatePiEvent, turnState } = createPiEventTranslator({
    providerId: "pi",
    turnIdPrefix: opts?.turnIdPrefix,
    resolveModelContextWindow: opts?.resolveModelContextWindow,
  });

  return {
    ...createStandardAdapterMembers({
      id: providerInfo.id,
      displayName: providerInfo.displayName,
      capabilities,
      approvalRequestPolicy: "runtime",
      classifyExecutionSettingsChange: classifySessionExecutionSettingsChange,
      process: {
        command: opts?.bridgeNodeExecutablePath ?? "node",
        args: resolveBridgeProcessArgs({
          bridgeBundleDir: opts?.bridgeBundleDir,
          bundleFileName: "bb-pi-bridge.mjs",
          importMetaUrl: import.meta.url,
          bridgeRelativePath: "bridge/bridge.js",
        }),
        ...(opts?.bridgeNodeEnv !== undefined
          ? { env: opts.bridgeNodeEnv }
          : {}),
      },
      initializeParams: { clientInfo: { name: "bb", version: "1.0.0" } },
      codec: "normalized",
      turnState,
      translateEvent: translatePiEvent,
      buildProviderCommandPlan(command) {
        switch (command.type) {
          case "model/list":
            return {
              kind: "request",
              method: "model/list",
              params: command.cwd ? { cwd: command.cwd } : {},
            };
          case "skills/configure":
            return {
              kind: "noop",
              reason: "Pi skill paths are configured per session",
            };
          case "thread/start": {
            finishOpenProviderTurn({
              registry: turnState,
              threadId: command.threadId,
            });
            resetPiCommandOutputSnapshots(
              turnState.getOrCreate({ threadId: command.threadId }),
            );
            const config = buildPiConfig(command.threadId, command.options);
            const dynamicTools = command.dynamicTools?.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: JSON.parse(JSON.stringify(t.inputSchema)),
            }));
            const additionalSkillPathsParams =
              buildPiAdditionalSkillPathsParams(command.options.skillRoots);
            return {
              kind: "request",
              method: "thread/start",
              params: {
                threadId: command.threadId,
                cwd: command.cwd,
                ...resolvePiInstructionOverrides(command),
                ...(additionalSkillPathsParams
                  ? additionalSkillPathsParams
                  : {}),
                ...(config ? { config } : {}),
                ...(command.options?.model
                  ? { model: command.options.model }
                  : {}),
                ...(command.options?.reasoningLevel
                  ? {
                      reasoningLevel: toPiThinkingLevel(
                        command.options.reasoningLevel,
                      ),
                    }
                  : {}),
                ...(dynamicTools && dynamicTools.length > 0
                  ? { dynamicTools }
                  : {}),
              },
            };
          }
          case "thread/resume": {
            finishOpenProviderTurn({
              registry: turnState,
              threadId: command.threadId,
            });
            resetPiCommandOutputSnapshots(
              turnState.getOrCreate({ threadId: command.threadId }),
            );
            const threadId = command.providerThreadId;
            const config = buildPiConfig(command.threadId, command.options);
            const dynamicTools = command.dynamicTools?.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: JSON.parse(JSON.stringify(t.inputSchema)),
            }));
            const additionalSkillPathsParams =
              buildPiAdditionalSkillPathsParams(command.options.skillRoots);
            return {
              kind: "request",
              method: "thread/resume",
              params: {
                threadId,
                cwd: command.cwd,
                ...resolvePiInstructionOverrides(command),
                ...(additionalSkillPathsParams
                  ? additionalSkillPathsParams
                  : {}),
                ...(config ? { config } : {}),
                ...(command.options?.model
                  ? { model: command.options.model }
                  : {}),
                ...(command.options?.reasoningLevel
                  ? {
                      reasoningLevel: toPiThinkingLevel(
                        command.options.reasoningLevel,
                      ),
                    }
                  : {}),
                ...(dynamicTools && dynamicTools.length > 0
                  ? { dynamicTools }
                  : {}),
              },
            };
          }
          case "turn/start": {
            const input = flattenPromptInputGroups(
              command.input,
              command.inputGroups,
            );
            if (isStandaloneBuiltinCompactCommand(input)) {
              return {
                kind: "request",
                method: "thread/compact",
                params: { threadId: command.providerThreadId },
              };
            }
            return {
              kind: "request",
              method: "turn/start",
              params: {
                threadId: command.providerThreadId,
                input,
                ...(command.options?.model
                  ? { model: command.options.model }
                  : {}),
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
                input: flattenPromptInputGroups(
                  command.input,
                  command.inputGroups,
                ),
              },
            };
          case "thread/fork": {
            // Pi's provider identity == the bb threadId, so the source pi session
            // id is command.sourceProviderThreadId (the source bb thread id). The
            // new thread keeps command.threadId as its identity; the bridge forks
            // the source session's full history into the new thread's
            // deterministic session file. Same session-config fields as
            // thread/start so the forked session launches identically.
            finishOpenProviderTurn({
              registry: turnState,
              threadId: command.threadId,
            });
            resetPiCommandOutputSnapshots(
              turnState.getOrCreate({ threadId: command.threadId }),
            );
            const config = buildPiConfig(command.threadId, command.options);
            const dynamicTools = command.dynamicTools?.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: JSON.parse(JSON.stringify(t.inputSchema)),
            }));
            const additionalSkillPathsParams =
              buildPiAdditionalSkillPathsParams(command.options.skillRoots);
            return {
              kind: "request",
              method: "thread/fork",
              params: {
                threadId: command.threadId,
                sourceProviderThreadId: command.sourceProviderThreadId,
                cwd: command.cwd,
                ...(command.sourceProviderCheckpointId !== undefined
                  ? {
                      providerCheckpointId: command.sourceProviderCheckpointId,
                    }
                  : {}),
                ...resolvePiInstructionOverrides(command),
                ...(additionalSkillPathsParams
                  ? additionalSkillPathsParams
                  : {}),
                ...(config ? { config } : {}),
                ...(command.options?.model
                  ? { model: command.options.model }
                  : {}),
                ...(command.options?.reasoningLevel
                  ? {
                      reasoningLevel: toPiThinkingLevel(
                        command.options.reasoningLevel,
                      ),
                    }
                  : {}),
                ...(dynamicTools && dynamicTools.length > 0
                  ? { dynamicTools }
                  : {}),
              },
            };
          }
          case "thread/stop":
            finishOpenProviderTurn({
              registry: turnState,
              threadId: command.threadId,
            });
            resetPiCommandOutputSnapshots(
              turnState.getOrCreate({ threadId: command.threadId }),
            );
            return {
              kind: "request",
              method: "thread/stop",
              params: {
                threadId: command.providerThreadId,
              },
            };
          case "thread/discard":
            return {
              kind: "request",
              method: "thread/discard",
              params: { threadId: command.providerThreadId },
            };
          default:
            return null;
        }
      },
    }),
  };
}
