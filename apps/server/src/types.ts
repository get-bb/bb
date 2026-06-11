import type { CustomProviderModel } from "@bb/config/bb-app-managed-config";
import type { DbConnection } from "@bb/db";
import type { FeatureFlags } from "@bb/domain";
import type { Logger } from "@bb/logger";
import type { PendingInteractionLifecycle } from "./services/interactions/pending-interactions.js";
import type { MachineAuthService } from "./services/machine-auth.js";
import type { AppVersionService } from "./services/system/app-version.js";
import type { BbAppManagedConfigReloader } from "./services/system/bb-app-managed-config.js";
import type { TerminalSessionLifecycle } from "./services/terminals/terminal-session-lifecycle.js";
import type { LifecycleDedupers } from "./lifecycle-dedupers.js";
import type { NotificationHub } from "./ws/hub.js";

export type ServerLogger = Pick<Logger, "debug" | "error" | "info" | "warn">;

export interface ServerRuntimeConfig {
  appVersion: string;
  builtinSkillsRootPath: string;
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
  /** Max workflow runs concurrently holding one host's capacity
   *  (BB_WORKFLOW_MAX_CONCURRENT_RUNS_PER_HOST; default 4). */
  workflowMaxConcurrentRunsPerHost: number;
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
  terminalSessions: TerminalSessionLifecycle;
}

export interface ServerAppDeps extends AppDeps {
  appVersion: AppVersionService;
  bbAppManagedConfig: BbAppManagedConfigReloader;
}

export type LifecycleDeps = Pick<
  AppDeps,
  "config" | "db" | "hub" | "lifecycleDedupers" | "machineAuth"
>;

export type WorkSessionDeps = LifecycleDeps;

export type LoggedWorkSessionDeps = WorkSessionDeps & Pick<AppDeps, "logger">;

export type PendingInteractionWorkSessionDeps = WorkSessionDeps &
  Pick<AppDeps, "pendingInteractions">;

export type LoggedPendingInteractionWorkSessionDeps =
  PendingInteractionWorkSessionDeps &
    Pick<AppDeps, "logger" | "terminalSessions">;
