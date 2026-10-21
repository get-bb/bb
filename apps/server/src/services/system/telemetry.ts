import { reportedProviderId } from "./provider-telemetry.js";
import { validWorkTelemetry } from "./work-telemetry-schema.js";
import type {
  AnalyticsThreadProperties,
  WorkOriginProperties,
} from "./work-telemetry.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { release } from "node:os";
import type { AppInstall } from "@bb/config/app-install";
import { DEFAULTS } from "@bb/config/defaults";
import type { ServerConfig } from "@bb/config/server";
import { readOrCreateSecretFile } from "@bb/secret-storage";
import type { AppSurface, RequestAppSurface } from "@bb/config/app-surface";
import type {
  FeatureUsedProperties,
  RecordTelemetryEventRequest,
} from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";

const POSTHOG_INGESTION_URL = "https://us.i.posthog.com/capture/";
const TELEMETRY_ID_FILE_NAME = "telemetry-id";

const telemetryAppSurfaceStorage = new AsyncLocalStorage<RequestAppSurface>();

export type TelemetryInitiator =
  | "user"
  | "agent"
  | "automation"
  | "plugin"
  | "system";
export type TurnFinishedOutcome = "succeeded" | "failed" | "stopped";

export type TurnErrorCategory =
  | "none"
  | "auth"
  | "billing"
  | "rate_limit"
  | "provider_unavailable"
  | "limit_reached"
  | "process_exited"
  | "start_failed"
  | "host_lost"
  | "other";

export type TelemetryEvent =
  | { name: "feature_used"; properties: FeatureUsedProperties }
  | {
      name: "thread_lifecycle_changed";
      properties: AnalyticsThreadProperties &
        Partial<WorkOriginProperties> & {
          transition:
            | "turn_started"
            | "waiting_on_user"
            | "waiting_cleared"
            | "thread_stopped"
            | "thread_archived"
            | "thread_unarchived"
            | "thread_deleted"
            | "parent_changed";
          wait_kind?: "question" | "approval" | "other" | "unknown";
        };
    }
  | { name: "app_started" }
  | { name: "telemetry_disabled" }
  | {
      name: "thread_created";
      properties: Partial<AnalyticsThreadProperties> & {
        is_child_thread: boolean;
        provider: string;
        initiator?: TelemetryInitiator;
      };
    }
  | {
      name: "user_message_sent";
      properties: Partial<AnalyticsThreadProperties> & {
        request_analytics_id?: string;
        is_child_thread: boolean;
        message_source: "queued_message" | "thread_create" | "thread_send";
        provider: string;
        initiator?: TelemetryInitiator;
      };
    }
  | {
      name: "turn_finished";
      properties: AnalyticsThreadProperties &
        WorkOriginProperties & {
          outcome: TurnFinishedOutcome;
          provider: string;
          error_category: TurnErrorCategory;
          install_turn_number: number;
        };
    }
  | {
      name: "plugin_installed";
      properties: {
        plugin_id: string | null;
        provenance: "builtin" | "catalog" | "direct";
        marketplace: string | null;
        source_kind: "builtin" | "git" | "npm" | "path";
      };
    }
  | RecordTelemetryEventRequest;

export interface TelemetryService {
  capture(event: TelemetryEvent, occurrenceTime?: number): void;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

interface CreateTelemetryServiceArgs {
  apiKey: string;
  appInstall: AppInstall | null;
  appSurface: AppSurface;
  appVersion: string;
  dataDir: string;
  enabled: boolean;
  telemetryEnabled: boolean;
  workTelemetry?: boolean;
  logger: ServerLogger;
}

const noopTelemetryService: TelemetryService = {
  capture: () => {},
  isEnabled: () => false,
  setEnabled: () => {},
};

export function createNoopTelemetryService(): TelemetryService {
  return noopTelemetryService;
}

export function appInstallFromServerConfig(
  config: Pick<
    ServerConfig,
    "BB_APP_INSTALL_KIND" | "BB_APP_SOURCE_COMMIT" | "BB_APP_SOURCE_ORIGIN"
  >,
): AppInstall | null {
  switch (config.BB_APP_INSTALL_KIND) {
    case undefined:
      return null;
    case "desktop":
    case "npm":
      return { kind: config.BB_APP_INSTALL_KIND };
    case "source":
      if (
        config.BB_APP_SOURCE_ORIGIN === "official" &&
        config.BB_APP_SOURCE_COMMIT !== undefined
      ) {
        return {
          commit: config.BB_APP_SOURCE_COMMIT,
          kind: "source",
          origin: "official",
        };
      }
      return {
        kind: "source",
        origin: config.BB_APP_SOURCE_ORIGIN === "fork" ? "fork" : "none",
      };
  }
}

function appInstallProperties(install: AppInstall | null) {
  if (install === null) return { install_kind: "unmanaged" };
  if (install.kind !== "source") return { install_kind: install.kind };
  return { install_kind: "source", source_origin: install.origin };
}

export function currentTelemetryInitiator(): TelemetryInitiator {
  return telemetryAppSurfaceStorage.getStore() === undefined
    ? "system"
    : "user";
}

export function runWithTelemetryAppSurface<T>(
  appSurface: RequestAppSurface,
  callback: () => T,
): T {
  return telemetryAppSurfaceStorage.run(appSurface, callback);
}

export async function createTelemetryService(
  args: CreateTelemetryServiceArgs,
): Promise<TelemetryService> {
  if (
    !args.enabled ||
    args.apiKey.length === 0 ||
    args.appVersion === DEFAULTS.appVersion
  ) {
    return noopTelemetryService;
  }
  const distinctId = await readOrCreateSecretFile({
    bytes: 16,
    dataDir: args.dataDir,
    encoding: "hex",
    fileName: TELEMETRY_ID_FILE_NAME,
  });
  let telemetryEnabled = args.telemetryEnabled;
  const osRelease = release();
  const commonProperties = {
    ...appInstallProperties(args.appInstall),
    app_version: args.appVersion,
    arch: process.arch,
    is_wsl:
      process.platform === "linux" &&
      osRelease.toLowerCase().includes("microsoft"),
    node_version: process.version,
    os_release: osRelease,
    platform: process.platform,
  };
  return {
    setEnabled(enabled: boolean): void {
      telemetryEnabled = enabled;
    },
    isEnabled: () => telemetryEnabled && args.workTelemetry === true,
    capture(event: TelemetryEvent, occurrenceTime = Date.now()): void {
      if (!telemetryEnabled) return;
      if (
        [
          "feature_used",
          "automation_created",
          "split_view_opened",
          "thread_lifecycle_changed",
          "turn_finished",
          "device_paired",
        ].includes(event.name) &&
        !args.workTelemetry
      )
        return;
      const appSurface =
        telemetryAppSurfaceStorage.getStore() ?? args.appSurface;
      const rawProperties = "properties" in event ? event.properties : {};
      const eventProperties =
        "provider" in rawProperties &&
        typeof rawProperties.provider === "string"
          ? {
              ...rawProperties,
              provider: reportedProviderId(rawProperties.provider),
            }
          : rawProperties;
      if (!validWorkTelemetry(event.name, eventProperties)) return;
      const body = JSON.stringify({
        api_key: args.apiKey,
        distinct_id: distinctId,
        event: event.name,
        properties: {
          ...commonProperties,
          ...eventProperties,
          app_surface: appSurface,
        },
        timestamp: new Date(occurrenceTime).toISOString(),
      });
      fetch(POSTHOG_INGESTION_URL, {
        body,
        headers: { "content-type": "application/json" },
        method: "POST",
      }).catch((error: unknown) => {
        args.logger.debug(
          {
            app_surface: appSurface,
            err: error,
            event: event.name,
          },
          "Telemetry event send failed",
        );
      });
    },
  };
}
