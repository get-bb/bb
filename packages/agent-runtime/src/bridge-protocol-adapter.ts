/**
 * The one adapter the runtime drives: the Provider Bridge Protocol speaker.
 *
 * A bridge that speaks the canonical Provider Bridge Protocol
 * (@bb/provider-bridge-protocol) needs no bespoke adapter: commands map to
 * canonical methods, events arrive as already-translated ThreadEvents, and
 * session-behavior capabilities come from the initialize handshake — captured
 * here per process and consulted for gated session methods. Sessionless
 * maintenance methods are gated by the provider registration before a command
 * reaches this adapter.
 *
 * This adapter never diffs execution options (`classifyExecutionSettingsChange`
 * always reports "live"): options ride every command and the bridge
 * reconciles internally, reporting any session rebuild via the mandatory
 * `session/replaced` notification.
 */
import type {
  AvailableModel,
  ProviderCapabilities,
  ProviderFork,
  ThreadEvent,
} from "@bb/domain";
import { PROVIDER_FORK_VALUES } from "@bb/domain";
import { pendingInteractionPayloadSchema } from "@bb/domain";
import {
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  bridgeCapabilitiesSchema,
  initializeResultSchema,
  negotiateGrammarVersion,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_NOTIFICATION_METHOD,
  providerRecoveryNotificationSchema,
  threadDeltaNotificationParamsSchema,
  type BridgeCapabilities,
  type SkillsConfigureRoot,
} from "@bb/provider-bridge-protocol";
import {
  ASSEMBLER_GRAMMAR_VERSIONS,
  createDeltaAssembler,
} from "@bb/provider-bridge-protocol/assembler";
import { z } from "zod";
import type {
  AdapterCommand,
  ClassifyProviderExecutionSettingsChangeArgs,
  ProviderAcceptedCommandTranslationArgs,
  ProviderExecutionContext,
  ProviderExecutionSettingsChange,
} from "./provider-adapter.js";
import type {
  DecodedInteractiveRequest,
  DecodedToolCallRequest,
  ProviderCommandPlan,
  ProviderInboundRequest,
  ProviderInteractiveResponse,
  ProviderPostInitializeRequest,
  ProviderRuntimeEvent,
  BuildInteractiveResponseArgs,
} from "@bb/provider-bridge-protocol/bridge-kit";
import { decodeNormalizedProviderToolCallRequest } from "@bb/provider-bridge-protocol/bridge-kit";
import { parseAvailableModelList } from "./shared/available-models.js";
import type {
  AgentRuntimeProviderRecoveryHint,
  AgentRuntimeSkillRoot,
} from "./types.js";

/** A decoded recovery hint before the runtime stamps the provider id. */
export type ProviderRecoveryHint = Omit<
  AgentRuntimeProviderRecoveryHint,
  "providerId"
>;

/**
 * The one adapter the runtime drives: the Provider Bridge Protocol speaker.
 * Every provider — first-party plugin bridges, the daemon-bundled pi bridge,
 * third-party plugin bridges, the test harness's scripted echo bridge — runs
 * behind this contract, so there is no provider-specific implementation and
 * no interface for one to hide behind. The runtime owns the command plane
 * (it builds requests through `buildCommandPlan`, sends them, and reads the
 * results); the adapter owns the wire: the handshake, the `thread/delta`
 * assembler, the tool-call and interaction codecs.
 */
export interface BridgeProtocolAdapter {
  id: string;
  capabilities: ProviderCapabilities;
  /**
   * Where approval escalation is enforced, as the handshake reported it.
   * `runtime`: the runtime applies the thread's current policy to every
   * forwarded request. `provider`: the bridge enforced the policy before
   * forwarding, so a forwarded approval must not be reclassified against
   * mutable thread settings.
   */
  readonly approvalEnforcedBy: "runtime" | "provider";
  process: { command: string; args: string[]; env?: Record<string, string> };
  /**
   * Classifies execution-setting drift. `live` settings ride the next turn
   * command; `session` settings require rebuilding the provider session.
   * Bridges reconcile options internally, so the answer is always `live`.
   */
  classifyExecutionSettingsChange(
    args: ClassifyProviderExecutionSettingsChangeArgs,
  ): ProviderExecutionSettingsChange;
  buildCommandPlan(command: AdapterCommand): ProviderCommandPlan;
  /** The `initialize` handshake, sent before any thread work starts. */
  buildPostInitializeRequests(): readonly ProviderPostInitializeRequest[];
  parseModelListResult(result: unknown): {
    models: AvailableModel[];
    selectedOnlyModels: AvailableModel[];
  };
  /** Assemble a bridge notification into canonical timeline events. */
  translateEvent(event: ProviderRuntimeEvent): ThreadEvent[];
  /**
   * A typed `provider/recovery` hint carried by this notification, or null
   * for anything else. Decoded here (the adapter owns the wire), forwarded by
   * the runtime to `onProviderRecovery` — never a timeline event.
   */
  decodeRecoveryHint(event: ProviderRuntimeEvent): ProviderRecoveryHint | null;
  /** Events implied by a successful command; the bridge protocol has none. */
  translateAcceptedCommand(
    args: ProviderAcceptedCommandTranslationArgs,
  ): ThreadEvent[];
  decodeToolCallRequest(
    request: ProviderInboundRequest,
  ): DecodedToolCallRequest | null;
  decodeInteractiveRequest(
    request: ProviderInboundRequest,
  ): DecodedInteractiveRequest | null;
  buildInteractiveResponse(
    args: BuildInteractiveResponseArgs,
  ): ProviderInteractiveResponse;
}

/**
 * A bridge adapter is built from the provider's DECLARED capabilities, which
 * name the fork ladder directly ({@link ProviderFork}) rather than the two
 * booleans clients gate on. The adapter projects those booleans onto its
 * public {@link BridgeProtocolAdapter.capabilities}, and keeps the ladder to
 * bound what the initialize handshake may claim.
 */
interface BridgeAdapterCapabilities extends Omit<
  ProviderCapabilities,
  "supportsFork" | "supportsSessionRewind"
> {
  fork: ProviderFork;
}

interface BridgeProtocolAdapterOptions {
  id: string;
  capabilities: BridgeAdapterCapabilities;
  process: { command: string; args: string[]; env?: Record<string, string> };
  /**
   * Provider-scoped options merged under `options.providerOptions` on every
   * session and turn command (per-command values win). The transitional
   * delivery path for data the provider's bridge needs but core does not
   * interpret — e.g. the ACP launch spec.
   */
  staticProviderOptions?: Record<string, unknown>;
}

const threadIdentityNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
    providerThreadId: z.string().min(1),
    sessionRestorable: z.boolean().optional(),
  })
  .passthrough();

const sessionReplacedNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
    providerThreadId: z.string().min(1).nullable(),
    reason: z.string().min(1),
    contextLost: z.boolean().default(false),
  })
  .passthrough();

const errorNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1).optional(),
    providerThreadId: z.string().min(1).optional(),
    message: z.string().min(1),
  })
  .passthrough();

const interactionRequestParamsSchema = z.object({
  providerThreadId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  turnId: z.union([z.string().min(1), z.null()]),
  payload: pendingInteractionPayloadSchema,
  /**
   * The request's ids are provider-native (a thread/delta bridge holds no bb
   * ids): translate the turn id and approval-subject item ids through the
   * delta assembler's maps so the app sees the timeline's own ids.
   */
  providerNativeIds: z.boolean().optional(),
});

/** The provider-native-id marker on a normalized tool-call request. */
const providerNativeIdsParamsSchema = z
  .object({ providerNativeIds: z.boolean().optional() })
  .passthrough();

/**
 * Execution options → canonical wire options. Core execution fields map
 * one-to-one; the plugin-derived `providerOptions` bag is merged over the
 * bridge's static options (declared `experimental_bridgeOptions`, the ACP
 * launch spec, the environment's extra write roots) so the bridge reads one
 * bag.
 */
function toBridgeWireOptions(
  options: ProviderExecutionContext,
  staticProviderOptions?: Record<string, unknown>,
): Record<string, unknown> {
  const {
    model,
    serviceTier,
    reasoningLevel,
    promptMode,
    instructions,
    envVars,
    permissionMode,
    permissionScope,
    approvalReviewer,
    permissionEscalation,
  } = options;
  const providerOptions = {
    ...staticProviderOptions,
    ...options.providerOptions,
  };
  return {
    ...(model !== undefined ? { model } : {}),
    ...(serviceTier !== undefined ? { serviceTier } : {}),
    ...(reasoningLevel !== undefined ? { reasoningLevel } : {}),
    ...(promptMode !== undefined ? { promptMode } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(envVars !== undefined ? { envVars } : {}),
    permissionMode,
    permissionScope,
    approvalReviewer,
    permissionEscalation,
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  };
}

/**
 * Provider-flavored skill roots → the canonical `skills/configure` roots. The
 * runtime has already filtered the roots to the target provider, so each root
 * contributes the one directory its provider consumes; ACP additionally names
 * its skills because they ride the session instructions rather than a scanned
 * directory.
 */
function toBridgeSkillRoots(
  skillRoots: readonly AgentRuntimeSkillRoot[],
): SkillsConfigureRoot[] {
  return skillRoots.map((skillRoot) => ({
    id: skillRoot.id,
    path:
      skillRoot.providerId === "claude-code"
        ? skillRoot.localPluginPath
        : skillRoot.skillDirectoryRootPath,
    skills:
      skillRoot.providerId === "acp"
        ? skillRoot.skills.map((skill) => ({
            name: skill.name,
            description: skill.description,
          }))
        : [],
  }));
}

export function createBridgeProtocolAdapter(
  options: BridgeProtocolAdapterOptions,
): BridgeProtocolAdapter {
  let handshake: BridgeCapabilities = bridgeCapabilitiesSchema.parse({});
  const { fork: declaredFork, ...declaredCapabilities } = options.capabilities;
  const capabilities: ProviderCapabilities = {
    ...declaredCapabilities,
    supportsFork: declaredFork !== "none",
    supportsSessionRewind: declaredFork === "checkpoint",
  };
  /**
   * The operative fork ladder: the declaration is a ceiling and the handshake
   * may only narrow it, so the effective value is whichever of the two sits
   * lower on the ordinal ladder. A bridge that claims more than its provider
   * declared is held to the declaration.
   */
  function effectiveFork(): ProviderFork {
    return PROVIDER_FORK_VALUES.indexOf(handshake.fork) <
      PROVIDER_FORK_VALUES.indexOf(declaredFork)
      ? handshake.fork
      : declaredFork;
  }
  // The narrow grammar: bridges emit parsed semantic deltas (`thread/delta`)
  // and this assembler constructs every canonical timeline event.
  const deltaAssembler = createDeltaAssembler({ providerId: options.id });

  function gate(
    capability: keyof BridgeCapabilities & string,
    plan: ProviderCommandPlan,
  ): ProviderCommandPlan {
    if (handshake[capability] === true) {
      return plan;
    }
    return { kind: "noop", reason: `${capability} not advertised` };
  }

  const adapter: BridgeProtocolAdapter = {
    id: options.id,
    capabilities,
    // The handshake owns approval-policy placement; before it completes the
    // runtime-owned default is the safe reading (every request re-checked).
    get approvalEnforcedBy() {
      return handshake.approvalEnforcedBy;
    },
    process: options.process,

    // Options ride every command; the bridge reconciles internally.
    classifyExecutionSettingsChange: () => "live",

    buildCommandPlan(command: AdapterCommand): ProviderCommandPlan {
      switch (command.type) {
        case "initialize":
          // The real initialize runs as a post-initialize request so the
          // handshake result can be captured (the plain initialize path
          // discards results).
          return { kind: "noop", reason: "initialize handled post-spawn" };
        case "model/list":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.modelList,
            params: {
              ...(command.cwd !== undefined ? { cwd: command.cwd } : {}),
              // Model listing has no session to carry providerOptions, so the
              // provider-scoped statics (e.g. the ACP launch spec the bridge
              // resolves its list command from) ride the request directly.
              ...(options.staticProviderOptions !== undefined
                ? { providerOptions: options.staticProviderOptions }
                : {}),
            },
          };
        case "provider/health":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.experimentalProviderHealth,
            params: {
              providerId: options.id,
              ...(command.cwd !== undefined ? { cwd: command.cwd } : {}),
              ...(options.staticProviderOptions !== undefined
                ? { providerOptions: options.staticProviderOptions }
                : {}),
            },
          };
        case "provider/usage":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.experimentalProviderUsage,
            params: {
              providerId: options.id,
              ...(command.cwd !== undefined ? { cwd: command.cwd } : {}),
              ...(options.staticProviderOptions !== undefined
                ? { providerOptions: options.staticProviderOptions }
                : {}),
            },
          };
        case "provider/installation/status":
          return {
            kind: "request",
            method:
              BRIDGE_REQUEST_METHODS.experimentalProviderInstallationStatus,
            params: {
              providerId: options.id,
              ...(command.requirement !== undefined
                ? { requirement: command.requirement }
                : {}),
              ...(command.cwd !== undefined ? { cwd: command.cwd } : {}),
              ...(options.staticProviderOptions !== undefined
                ? { providerOptions: options.staticProviderOptions }
                : {}),
            },
          };
        case "provider/installation/run":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.experimentalProviderInstallationRun,
            params: {
              providerId: options.id,
              action: command.action,
              ...(command.cwd !== undefined ? { cwd: command.cwd } : {}),
              ...(options.staticProviderOptions !== undefined
                ? { providerOptions: options.staticProviderOptions }
                : {}),
            },
          };
        case "skills/configure":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.skillsConfigure,
            params: { roots: toBridgeSkillRoots(command.skillRoots) },
          };
        case "thread/start":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadStart,
            params: {
              threadId: command.threadId,
              cwd: command.cwd,
              options: toBridgeWireOptions(
                command.options,
                options.staticProviderOptions,
              ),
              ...(command.dynamicTools !== undefined
                ? { dynamicTools: command.dynamicTools }
                : {}),
              ...(command.disallowedTools !== undefined
                ? { disallowedTools: command.disallowedTools }
                : {}),
              instructionMode: command.instructionMode,
            },
          };
        case "thread/resume":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadResume,
            params: {
              threadId: command.threadId,
              cwd: command.cwd,
              providerThreadId: command.providerThreadId,
              options: toBridgeWireOptions(
                command.options,
                options.staticProviderOptions,
              ),
              ...(command.dynamicTools !== undefined
                ? { dynamicTools: command.dynamicTools }
                : {}),
              ...(command.disallowedTools !== undefined
                ? { disallowedTools: command.disallowedTools }
                : {}),
              instructionMode: command.instructionMode,
            },
          };
        case "thread/fork": {
          // Without this gate a bridge that cannot fork (or can only fork at
          // the tip) is sent the request anyway and answers however it likes —
          // ACP rejects a checkpoint fork with FORK_CHECKPOINT_UNSUPPORTED,
          // but a bridge that never advertised fork at all has no obligation
          // to reject and may silently hand back a fresh, empty session.
          const fork = effectiveFork();
          if (fork === "none") {
            throw new Error(
              `Provider "${options.id}" does not support forking a thread`,
            );
          }
          if (
            fork === "tip" &&
            command.sourceProviderCheckpointId !== undefined
          ) {
            throw new Error(
              `Provider "${options.id}" can only fork at the end of a session, not from an earlier point in it`,
            );
          }
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadFork,
            params: {
              threadId: command.threadId,
              cwd: command.cwd,
              sourceProviderThreadId: command.sourceProviderThreadId,
              ...(command.sourceProviderCheckpointId !== undefined
                ? {
                    sourceProviderCheckpointId:
                      command.sourceProviderCheckpointId,
                  }
                : {}),
              options: toBridgeWireOptions(
                command.options,
                options.staticProviderOptions,
              ),
              ...(command.dynamicTools !== undefined
                ? { dynamicTools: command.dynamicTools }
                : {}),
              ...(command.disallowedTools !== undefined
                ? { disallowedTools: command.disallowedTools }
                : {}),
              instructionMode: command.instructionMode,
            },
          };
        }
        case "turn/start":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.turnStart,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
              input: command.input,
              clientRequestId: command.clientRequestId,
              options: toBridgeWireOptions(
                command.options,
                options.staticProviderOptions,
              ),
            },
          };
        case "turn/steer":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.turnSteer,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
              // Central minting made turn ids runtime-owned: a bridge
              // receives its provider's own turn id back (the assembler's
              // reverse map) and does zero id translation. Bridges without
              // native turn ids (pi, acp) have no mapping, so the bb id
              // passes through unchanged.
              expectedTurnId:
                deltaAssembler.getProviderTurnId(
                  command.threadId,
                  command.expectedTurnId,
                ) ?? command.expectedTurnId,
              input: command.input,
              clientRequestId: command.clientRequestId,
              options: toBridgeWireOptions(
                command.options,
                options.staticProviderOptions,
              ),
            },
          };
        case "thread/stop":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadStop,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
              // The adapter command predates the daemon-level intent split;
              // a stop with an active turn is an interrupt, an idle stop is
              // a release. Phase 2a threads the daemon's explicit intent
              // through instead.
              intent: command.activeTurnId !== null ? "interrupt" : "release",
              // Same reverse mapping as turn/steer's expectedTurnId.
              activeTurnId:
                command.activeTurnId === null
                  ? null
                  : (deltaAssembler.getProviderTurnId(
                      command.threadId,
                      command.activeTurnId,
                    ) ?? command.activeTurnId),
            },
          };
        case "thread/discard":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadDiscard,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
            },
          };
        case "thread/name/set":
          return gate("threadRename", {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadNameSet,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
              title: command.title,
            },
          });
        case "thread/archive":
          return gate("threadArchive", {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadArchive,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
            },
          });
        case "thread/unarchive":
          return gate("threadArchive", {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadUnarchive,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
            },
          });
        case "thread/goal/clear":
          return gate("threadGoalClear", {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadGoalClear,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
            },
          });
      }
    },

    buildPostInitializeRequests(): readonly ProviderPostInitializeRequest[] {
      return [
        {
          required: true,
          plan: {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.initialize,
            params: {
              protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
              client: { name: "bb", version: "1.0.0" },
              // The assembler's grammar range, so a bridge that speaks a
              // wider range emits only what this runtime can assemble.
              grammarVersions: ASSEMBLER_GRAMMAR_VERSIONS,
            },
          },
          onResult(result) {
            const parsed = initializeResultSchema.safeParse(result);
            if (!parsed.success) {
              // A malformed handshake is as fatal as a wrong version: falling
              // back to the default capabilities would run the bridge on
              // guesses (and silently mask the shape drift that produced it).
              // The post-initialize request is `required`, so this throw
              // aborts the provider spawn as a legible startup error.
              throw new Error(
                `Provider bridge "${options.id}" answered initialize with a malformed result (${parsed.error.issues
                  .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                  .join(
                    "; ",
                  )}). The bridge and this runtime cannot negotiate a handshake; update or fix the "${options.id}" provider plugin.`,
              );
            }
            // The version gates the handshake: a bridge on another major
            // revision speaks a timeline dialect this runtime does not
            // (version 1 emitted `thread/event`, which no longer exists), so
            // failing startup legibly beats a silently empty timeline. The
            // post-initialize request is `required`, so this throw aborts the
            // provider spawn and surfaces the message as the startup error.
            if (
              parsed.data.protocolVersion !== PROVIDER_BRIDGE_PROTOCOL_VERSION
            ) {
              throw new Error(
                `Provider bridge "${options.id}" speaks Provider Bridge Protocol version ${parsed.data.protocolVersion}, but this runtime requires version ${PROVIDER_BRIDGE_PROTOCOL_VERSION}. Update the "${options.id}" provider plugin to a build published for protocol version ${PROVIDER_BRIDGE_PROTOCOL_VERSION}.`,
              );
            }
            // Same gate for the delta grammar: a bridge whose range shares
            // no version with the assembler's would connect and then have
            // every `thread/delta` refused, which is the silently empty
            // timeline the version gate above exists to prevent.
            const grammarVersion = negotiateGrammarVersion(
              ASSEMBLER_GRAMMAR_VERSIONS,
              parsed.data.capabilities.grammarVersions,
            );
            if (grammarVersion === null) {
              const [bridgeMin, bridgeMax] =
                parsed.data.capabilities.grammarVersions;
              const [runtimeMin, runtimeMax] = ASSEMBLER_GRAMMAR_VERSIONS;
              throw new Error(
                `Provider bridge "${options.id}" speaks thread/delta grammar versions ${bridgeMin}-${bridgeMax}, but this runtime assembles versions ${runtimeMin}-${runtimeMax}. Update the "${options.id}" provider plugin or bb so the two ranges overlap.`,
              );
            }
            handshake = parsed.data.capabilities;
          },
        },
      ];
    },

    parseModelListResult: parseAvailableModelList,

    translateEvent(event: ProviderRuntimeEvent): ThreadEvent[] {
      const method = event.method;
      if (method === THREAD_DELTA_NOTIFICATION_METHOD) {
        const parsed = threadDeltaNotificationParamsSchema.safeParse(
          event.params,
        );
        if (!parsed.success) {
          return [];
        }
        return deltaAssembler.assemble({
          threadId: parsed.data.threadId,
          deltas: parsed.data.deltas,
        });
      }
      if (method === BRIDGE_NOTIFICATION_METHODS.threadIdentity) {
        const parsed = threadIdentityNotificationParamsSchema.safeParse(
          event.params,
        );
        if (!parsed.success) {
          return [];
        }
        return [
          {
            type: "thread/identity",
            threadId: parsed.data.threadId,
            providerThreadId: parsed.data.providerThreadId,
            scope: { kind: "thread" },
          },
        ];
      }
      if (method === BRIDGE_NOTIFICATION_METHODS.sessionReplaced) {
        const parsed = sessionReplacedNotificationParamsSchema.safeParse(
          event.params,
        );
        if (
          !parsed.success ||
          parsed.data.providerThreadId === null ||
          !parsed.data.contextLost
        ) {
          return [];
        }
        return [
          {
            type: "provider/warning",
            threadId: parsed.data.threadId,
            providerThreadId: parsed.data.providerThreadId,
            category: "general",
            summary:
              "Provider session was replaced; provider-side context was lost.",
            details: parsed.data.reason,
            scope: { kind: "thread" },
          },
        ];
      }
      if (method === BRIDGE_NOTIFICATION_METHODS.error) {
        const parsed = errorNotificationParamsSchema.safeParse(event.params);
        if (
          !parsed.success ||
          parsed.data.threadId === undefined ||
          parsed.data.providerThreadId === undefined
        ) {
          return [];
        }
        return [
          {
            type: "provider/warning",
            threadId: parsed.data.threadId,
            providerThreadId: parsed.data.providerThreadId,
            category: "general",
            summary: parsed.data.message,
            scope: { kind: "thread" },
          },
        ];
      }
      // provider/raw is droppable diagnostics by contract; anything else is
      // forward skew from a newer bridge and is ignored the same way.
      return [];
    },

    decodeRecoveryHint(
      event: ProviderRuntimeEvent,
    ): ProviderRecoveryHint | null {
      if (event.method !== BRIDGE_NOTIFICATION_METHODS.providerRecovery) {
        return null;
      }
      const parsed = providerRecoveryNotificationSchema.safeParse(event.params);
      if (!parsed.success) {
        // A malformed hint is dropped like any other malformed notification:
        // the bridge's `provider/error` delta beside it carries the
        // user-visible consequence.
        return null;
      }
      return {
        ...(parsed.data.threadId === undefined
          ? {}
          : { threadId: parsed.data.threadId }),
        kind: parsed.data.kind,
        message: parsed.data.message,
        retryable: parsed.data.retryable,
      };
    },

    // Input acceptance rides `input.accepted` deltas through the assembler;
    // the adapter synthesizes nothing on command dispatch.
    translateAcceptedCommand: () => [],

    decodeToolCallRequest(
      request: ProviderInboundRequest,
    ): DecodedToolCallRequest | null {
      if (typeof request.id !== "string" && typeof request.id !== "number") {
        return null;
      }
      const decoded = decodeNormalizedProviderToolCallRequest(
        request.id,
        request.method,
        request.params,
      );
      if (decoded === null) {
        return decoded;
      }
      const marker = providerNativeIdsParamsSchema.safeParse(request.params);
      if (
        marker.success !== true ||
        marker.data.providerNativeIds !== true ||
        decoded.threadId === undefined
      ) {
        return decoded;
      }
      // Provider-native ids: translate through the assembler's maps so the
      // runtime routes against the timeline's own turn/item ids. Unknown ids
      // pass through unchanged (the maps only miss when the id never appeared
      // on the thread's delta stream).
      return {
        ...decoded,
        turnId:
          decoded.turnId === null
            ? null
            : (deltaAssembler.getBbTurnId(decoded.threadId, decoded.turnId) ??
              decoded.turnId),
        callId:
          deltaAssembler.getBbItemId(decoded.threadId, decoded.callId) ??
          decoded.callId,
      };
    },

    decodeInteractiveRequest(
      request: ProviderInboundRequest,
    ): DecodedInteractiveRequest | null {
      if (
        request.method !== BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest ||
        (typeof request.id !== "string" && typeof request.id !== "number")
      ) {
        return null;
      }
      const parsed = interactionRequestParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return null;
      }
      const { providerNativeIds, threadId, ...decoded } = parsed.data;
      let turnId = decoded.turnId;
      let payload = decoded.payload;
      if (providerNativeIds === true && threadId !== undefined) {
        // Provider-native ids: the approval subject must reference the item
        // id the app's timeline carries (the server materializes the approval
        // row under subject.itemId), and the turn id must be the assembler's.
        turnId =
          turnId === null
            ? null
            : (deltaAssembler.getBbTurnId(threadId, turnId) ?? turnId);
        if (payload.kind === "approval") {
          payload = {
            ...payload,
            subject: {
              ...payload.subject,
              itemId:
                deltaAssembler.getBbItemId(threadId, payload.subject.itemId) ??
                payload.subject.itemId,
            },
          };
        }
      }
      return {
        requestId: request.id,
        method: request.method,
        providerThreadId: decoded.providerThreadId,
        turnId,
        payload,
        ...(threadId ? { threadId } : {}),
      };
    },

    buildInteractiveResponse(
      args: BuildInteractiveResponseArgs,
    ): ProviderInteractiveResponse {
      // The wire response IS the canonical resolution. The cast is a genuine
      // boundary: PendingInteractionResolution is plain JSON data but TS
      // cannot prove assignability into the recursive wire-response type.
      return args.resolution as unknown as ProviderInteractiveResponse;
    },
  };

  return adapter;
}
