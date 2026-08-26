import type { AiServiceRegistry } from "../ai/ai-service-registry.js";
import type { DbConnection } from "@bb/db";
import type {
  DispatchHoldReportUpdate,
  DynamicTool,
  Thread,
} from "@bb/domain";
import type { PluginDispatchAmendments } from "@get-bb/plugin-sdk";
import type { HostDaemonConnectTunnelIdentity } from "@bb/host-daemon-contract";
import {
  pluginUpdateCheckEntrySchema,
  type DispatchHoldResponse,
  type InstalledPlugin,
  type PluginApplyUpdateResult,
  type PluginRuntimeStatus,
  type PluginSourceDetail,
} from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";
import type { TelemetryService } from "../system/telemetry.js";
import type { NotificationHub } from "../../ws/hub.js";
import type { BundledPluginRegistration } from "./builtin-registry.js";
import type { PluginManifest } from "./manifest.js";
import type {
  PluginApiHandle,
  PluginBackgroundServiceRecord,
  PluginMentionTrigger,
} from "./plugin-api.js";
import type { HostSharedPortCoordinator } from "../../ws/host-shared-ports.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import type { PluginHostArtifactRegistry } from "./plugin-host-artifact-registry.js";
export type {
  PluginHandlerStats,
  PluginRuntimeStatus,
  PluginUpdateCheckEntry,
} from "@bb/server-contract";

type PluginServiceState = "running" | "backoff" | "stopped";

export type PluginListEntry = InstalledPlugin;

export interface ServiceRuntime {
  record: PluginBackgroundServiceRecord;
  state: PluginServiceState;
  controller: AbortController | null;
  current: Promise<void> | null;
  restartTimer: NodeJS.Timeout | null;
  consecutiveCrashes: number;
  startedAt: number;
  disposed: boolean;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  handle: PluginApiHandle;
  services: ServiceRuntime[];
}

export interface PluginHostArtifactSnapshot {
  path: string;
  byteLength: number;
  digest: string;
  generation: string;
}

export interface PluginServiceDeps {
  db: DbConnection;
  sharedPorts?: Pick<
    HostSharedPortCoordinator,
    | "declareSharedPorts"
    | "validateSharedPortDeclaration"
    | "replaceDeclarationsForOwner"
    | "clearDeclarationsForOwner"
  >;
  ensureSharedPortTunnel?: (
    hostId: string,
  ) => Promise<HostDaemonConnectTunnelIdentity>;
  providerRegistry?: ProviderRegistryService;
  pluginHostArtifacts?: PluginHostArtifactRegistry;
  aiServices: AiServiceRegistry;
  onSettingsChanged?: (pluginId: string) => void;
  /**
   * Fired after a plugin stops being a registered owner — disabled or
   * uninstalled, but *not* reloaded. Core state keyed by `plugin:<id>`
   * (dispatch holds it owns) is released here instead of waiting for a sweep.
   */
  onPluginUnregistered?: (pluginId: string) => void;
  /**
   * Owner-scoped hold operations behind `bb.experimental_dispatch.release` and
   * `.report`. Assembled in server.ts where the full thread services exist;
   * omitted only by isolated plugin-runtime tests, where either call throws.
   */
  dispatchHolds?: {
    release(args: {
      pluginId: string;
      holdId: string;
      amend: PluginDispatchAmendments | undefined;
    }): Promise<void>;
    report(args: {
      pluginId: string;
      holdId: string;
      update: DispatchHoldReportUpdate;
    }): Promise<boolean>;
  };
  /**
   * Display-only timeline notes behind `bb.experimental_threads.appendNote`.
   * Assembled in server.ts alongside `dispatchHolds`; omitted only by isolated
   * plugin-runtime tests, where the call throws.
   */
  appendThreadNote?: (args: {
    pluginId: string;
    threadId: string;
    note: unknown;
  }) => void;
  /** Per-gate decision box; tests shrink it to exercise the timeout path. */
  dispatchGateTimeoutMs?: number;
  /** Thread DTO assembly for lifecycle events + plugin-signal broadcast +
   * the `plugins-changed` system broadcast on lifecycle completion. */
  hub: Pick<
    NotificationHub,
    "getDaemonSessionIdForHost" | "notifyPluginSignal" | "notifySystem"
  >;
  logger: ServerLogger;
  telemetry: TelemetryService;
  pendingInteractions?: Pick<
    import("../interactions/pending-interactions.js").PendingInteractionLifecycle,
    | "requestPluginInteraction"
    | "interruptPluginInteractions"
    | "setPluginDirectory"
  >;
  dataDir: string;
  appVersion: string;
  bundledPlugins?: readonly BundledPluginRegistration[];
  watchBuiltinPluginSources?: boolean;
  loadTimeoutMs?: number;
  serviceStopTimeoutMs?: number;
  serviceRestartBaseMs?: number;
  mentionSearchTimeoutMs?: number;
  mentionResolveTimeoutMs?: number;
  stabilizationWindowMs?: number;
  artifactRetentionMs?: number;
  now?: () => number;
  scheduleStabilizationWindow?: (
    durationMs: number,
    onElapsed: () => void,
  ) => () => void;
  scheduleUpdateCheck?: (delayMs: number, onElapsed: () => void) => () => void;
  afterPluginRollbackStateRestored?: (args: {
    pluginId: string;
    snapshotId: string;
  }) => Promise<void>;
  afterArtifactPromoted?: (args: {
    pluginId: string;
    artifactId: string;
    path: string;
  }) => Promise<void>;
  onArtifactMaterialize?: (args: { path: string }) => void;
  callPluginHost?: (args: {
    pluginId: string;
    contract: import("@get-bb/plugin-sdk").PluginRpcContract;
    method: string;
    input: unknown;
    hostId: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    artifact: PluginHostArtifactSnapshot;
  }) => Promise<unknown>;
  disposePluginHost?: (args: {
    pluginId: string;
    generation: string;
  }) => Promise<void>;
}

export interface PluginAgentToolContribution {
  pluginId: string;
  tool: DynamicTool;
  instructions: string | null;
}

export interface PluginInstructionContribution {
  pluginId: string;
  provider: (ctx: { threadId: string; projectId: string }) => string | null;
}

export interface PluginResolvedAgentConfiguration {
  tools: PluginAgentToolContribution[];
  selectedSkillIdsByPlugin: ReadonlyMap<string, ReadonlySet<string>>;
  dynamicInstructions: Array<{ pluginId: string; text: string }>;
}

export interface PluginMentionProviderContribution {
  pluginId: string;
  id: string;
  label: string;
  triggers: readonly PluginMentionTrigger[];
}

export interface PluginMentionSearchItem {
  itemId: string;
  title: string;
  subtitle: string | null;
  icon: string | null;
}

export interface PluginMentionSearchGroup {
  pluginId: string;
  providerId: string;
  label: string;
  items: PluginMentionSearchItem[];
}

export type PluginMentionResolveResult =
  | { ok: true; context: string }
  | { ok: false; error: string };

export interface PluginThreadEventEmitter {
  emitThreadCreated(thread: Thread): void;
  emitThreadActive(thread: Thread): void;
  emitThreadIdle(thread: Thread): void;
  emitThreadFailed(thread: Thread): void;
  emitThreadArchived(thread: Thread): void;
  emitThreadDeleted(thread: Thread): void;
  /**
   * Hold lifecycle. The row is already in its new state when these fire; the
   * DTO is built once and shared by every listener, exactly like the thread
   * events above.
   */
  emitDispatchHeld(hold: DispatchHoldResponse): void;
  emitDispatchReleased(hold: DispatchHoldResponse): void;
  emitDispatchCancelled(hold: DispatchHoldResponse): void;
}

export type PluginWireLookup<T> =
  | { outcome: "unknown-plugin" }
  | {
      outcome: "not-running";
      status: PluginRuntimeStatus;
      detail: string | null;
    }
  | { outcome: "not-found" }
  | { outcome: "found"; value: T };

export { pluginUpdateCheckEntrySchema };
export type PluginSourceView = PluginSourceDetail;

export type PluginApplyUpdateOutcome =
  | { ok: true; result: PluginApplyUpdateResult }
  | { ok: false; error: string };
