import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULTS } from "@bb/config/defaults";
import { readOrCreateSecretFile } from "@bb/secret-storage";
import type { AppSurface } from "@bb/config/app-surface";
import type { ServerLogger } from "../../types.js";

/**
 * Anonymous usage telemetry.
 *
 * Sends a small set of product events (app starts, thread creation counts,
 * user message counts, and plugin installs) to PostHog so install/activation
 * funnels can be measured.
 * Identification is a random per-install id persisted in the data dir — no
 * user, host, project, workspace, or message content is ever attached.
 *
 * Delivery is intentionally fire-and-forget: events are analytics, not
 * workflow state, so lost sends (offline, PostHog outage, process exit
 * mid-flight) are dropped without retry or persistence.
 *
 * A default public write-only PostHog key ships in @bb/config. Telemetry only
 * activates for production server runs with a resolved release version (the
 * bb-app launcher and desktop app set NODE_ENV=production). Dev/source runs
 * never send, even if a test starts them in production mode.
 * Disabled telemetry creates nothing, not even the install-id file. Opt out
 * any run with BB_TELEMETRY=false; override the key with BB_POSTHOG_API_KEY.
 */

const POSTHOG_INGESTION_URL = "https://us.i.posthog.com/capture/";
const TELEMETRY_ID_FILE_NAME = "telemetry-id";

const telemetryAppSurfaceStorage = new AsyncLocalStorage<AppSurface>();

/**
 * Which coding agents the machine had when onboarding opened. Answers "how many
 * installs have no compatible CLI" directly: count distinct install ids with
 * `onboarding_started` where `agent_state = none`.
 */
export type OnboardingAgentState = "connected" | "signed_out" | "none";

export type TelemetryEvent =
  | { name: "app_started" }
  | {
      name: "onboarding_started";
      properties: {
        agent_state: OnboardingAgentState;
        detected_agent_count: number;
      };
    }
  | {
      name: "onboarding_step_completed";
      properties: { step: "agents" | "projects" };
    }
  | {
      name: "onboarding_step_skipped";
      properties: { step: "agents" | "projects" };
    }
  | {
      name: "onboarding_completed";
      properties: {
        agent_state: OnboardingAgentState;
        projects_added: number;
        duration_ms: number;
      };
    }
  | {
      name: "onboarding_dismissed";
      properties: { step: "agents" | "projects" };
    }
  | {
      name: "thread_created";
      properties: {
        is_child_thread: boolean;
        provider: string;
      };
    }
  | {
      name: "user_message_sent";
      properties: {
        is_child_thread: boolean;
        message_source: "queued_message" | "thread_create" | "thread_send";
        provider: string;
      };
    }
  | {
      /**
       * One user-initiated plugin install (CLI, store, or API). Bundled
       * plugins that auto-install at boot do not send this. Rank plugins by
       * install count with a trend on this event broken down by `plugin_id`.
       */
      name: "plugin_installed";
      properties: {
        /**
         * Manifest id for public plugins: bundled builtins and entries of the
         * curated `bb-community` marketplace. Null for direct installs and
         * third-party catalogs, whose ids and sources may name private code.
         */
        plugin_id: string | null;
        provenance: "builtin" | "catalog" | "direct";
        /** `bb-community` for curated catalog installs; null otherwise. */
        marketplace: string | null;
        source_kind: "builtin" | "git" | "npm" | "path";
      };
    };

export interface TelemetryService {
  capture(event: TelemetryEvent): void;
}

export interface CreateTelemetryServiceArgs {
  apiKey: string;
  appSurface: AppSurface;
  appVersion: string;
  dataDir: string;
  enabled: boolean;
  logger: ServerLogger;
}

const noopTelemetryService: TelemetryService = {
  capture: () => {},
};

/** No-op service for tests and other places that need the dependency shape. */
export function createNoopTelemetryService(): TelemetryService {
  return noopTelemetryService;
}

export function runWithTelemetryAppSurface<T>(
  appSurface: AppSurface,
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
  const commonProperties = {
    app_version: args.appVersion,
    arch: process.arch,
    platform: process.platform,
  };
  return {
    capture(event: TelemetryEvent): void {
      const appSurface =
        telemetryAppSurfaceStorage.getStore() ?? args.appSurface;
      const eventProperties = "properties" in event ? event.properties : {};
      const body = JSON.stringify({
        api_key: args.apiKey,
        distinct_id: distinctId,
        event: event.name,
        properties: {
          ...commonProperties,
          ...eventProperties,
          app_surface: appSurface,
        },
        timestamp: new Date().toISOString(),
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
