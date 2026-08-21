import type {
  CustomAcpAgent,
  CustomProviderModel,
} from "@bb/config/bb-app-managed-config";
import type { DbConnection } from "@bb/db";
import type { FeatureFlags, ProviderNativeSkillRoots } from "@bb/domain";
import type { Logger } from "@bb/logger";
import type { PendingInteractionLifecycle } from "./services/interactions/pending-interactions.js";
import type { MachineAuthService } from "./services/machine-auth.js";
import type { AppVersionService } from "./services/system/app-version.js";
import type { BbAppManagedConfigReloader } from "./services/system/bb-app-managed-config.js";
import type { TelemetryService } from "./services/system/telemetry.js";
import type { TerminalSessionLifecycle } from "./services/terminals/terminal-session-lifecycle.js";
import type { LifecycleDedupers } from "./lifecycle-dedupers.js";
import type { NotificationHub } from "./ws/hub.js";
import type { WatchInterestCoordinator } from "./ws/watch-interests.js";
import type { WorkspaceReadCaches } from "./services/environments/workspace-read-cache.js";
import type { HostSharedPortCoordinator } from "./ws/host-shared-ports.js";
import type { SkillTreeRegistry } from "./services/skills/injected-skills.js";
import type { ProviderRegistryService } from "./services/providers/provider-registry.js";
import type { PluginHostArtifactRegistry } from "./services/plugins/plugin-host-artifact-registry.js";

export type ServerLogger = Pick<Logger, "debug" | "error" | "info" | "warn">;

export interface ServerRuntimeConfig {
  appVersion: string;
  builtinSkillsRootPath: string;
  customAcpAgents: CustomAcpAgent[];
  customModels: CustomProviderModel[];
  dataDir: string;
  featureFlags: FeatureFlags;
  hostDaemonPort: number;
  inheritedSkillsRootPaths: string[];
  inferenceFallbackModel: string;
  inferenceModel: string;
  isDevelopment: boolean;
  /**
   * Grace window (ms) after the last live thread in a managed environment is
   * archived before its worktree is destroyed, during which an accidental
   * archive can be undone losslessly. Defaults to
   * {@link MANAGED_ENVIRONMENT_RETIRE_GRACE_MS}; set to 0 to destroy immediately.
   */
  managedEnvironmentRetireGraceMs: number;
  /** Manifest URL of the reserved `bb-community` plugin marketplace. */
  marketplaceUrl: string;
  openAiApiKey: string;
  serverPort: number;
  sharedSkillRoots: ProviderNativeSkillRoots;
  transcriptionModel: string;
  appUrl?: string;
  devAppPort?: number;
  /**
   * Per-spawn identity from the bb-app launcher, echoed on /health so the
   * launcher can tell this server from another one that owns the same port.
   * Absent when the server was not started by the launcher.
   */
  launchId?: string;
}

export interface AppDeps {
  config: ServerRuntimeConfig;
  db: DbConnection;
  hub: NotificationHub;
  lifecycleDedupers: LifecycleDedupers;
  logger: ServerLogger;
  machineAuth: MachineAuthService;
  pendingInteractions: PendingInteractionLifecycle;
  providerRegistry: ProviderRegistryService;
  pluginHostArtifacts: PluginHostArtifactRegistry;
  skillTreeRegistry: SkillTreeRegistry;
  telemetry: TelemetryService;
  terminalSessions: TerminalSessionLifecycle;
  watchInterests: WatchInterestCoordinator;
  sharedPorts: HostSharedPortCoordinator;
  workspaceReadCaches: WorkspaceReadCaches;
}

export interface ServerAppDeps extends AppDeps {
  appVersion: AppVersionService;
  bbAppManagedConfig: BbAppManagedConfigReloader;
}

export type WorkSessionDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "hub"
  | "lifecycleDedupers"
  | "machineAuth"
  | "providerRegistry"
  | "pluginHostArtifacts"
  | "skillTreeRegistry"
  | "telemetry"
>;

export type LoggedWorkSessionDeps = WorkSessionDeps & Pick<AppDeps, "logger">;

export type LoggedPendingInteractionWorkSessionDeps = WorkSessionDeps &
  Pick<AppDeps, "logger" | "pendingInteractions" | "terminalSessions">;
