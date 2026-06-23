import type {
  CustomAcpAgent,
  CustomProviderModel,
} from "@bb/config/bb-app-managed-config";
import type { DbConnection } from "@bb/db";
import type { FeatureFlags } from "@bb/domain";
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

export type ServerLogger = Pick<Logger, "debug" | "error" | "info" | "warn">;

export interface ServerRuntimeConfig {
  appVersion: string;
  /**
   * Operator gate for script-mode automations (which execute arbitrary host
   * commands). DEFAULT ENABLED so the feature works out of the box; set
   * BB_AUTOMATIONS_ALLOW_SCRIPT_RUNS=false to forbid creating new script
   * automations (400) and to skip/fail script runs at execution time.
   */
  automationsAllowScriptRuns: boolean;
  builtinSkillsRootPath: string;
  customAcpAgents: CustomAcpAgent[];
  customModels: CustomProviderModel[];
  dataDir: string;
  featureFlags: FeatureFlags;
  hostDaemonPort: number;
  inferenceModel: string;
  isDevelopment: boolean;
  openAiApiKey: string;
  serverPort: number;
  threadStorageRootPath: string;
  transcriptionModel: string;
  appUrl?: string;
  devAppPort?: number;
}

export interface AppDeps {
  config: ServerRuntimeConfig;
  db: DbConnection;
  hub: NotificationHub;
  lifecycleDedupers: LifecycleDedupers;
  logger: ServerLogger;
  machineAuth: MachineAuthService;
  pendingInteractions: PendingInteractionLifecycle;
  telemetry: TelemetryService;
  terminalSessions: TerminalSessionLifecycle;
  watchInterests: WatchInterestCoordinator;
}

export interface ServerAppDeps extends AppDeps {
  appVersion: AppVersionService;
  bbAppManagedConfig: BbAppManagedConfigReloader;
}

export type LifecycleDeps = Pick<
  AppDeps,
  "config" | "db" | "hub" | "lifecycleDedupers" | "machineAuth" | "telemetry"
>;

export type WorkSessionDeps = LifecycleDeps;

export type LoggedWorkSessionDeps = WorkSessionDeps & Pick<AppDeps, "logger">;

export type PendingInteractionWorkSessionDeps = WorkSessionDeps &
  Pick<AppDeps, "pendingInteractions">;

export type LoggedPendingInteractionWorkSessionDeps =
  PendingInteractionWorkSessionDeps &
    Pick<AppDeps, "logger" | "terminalSessions">;
