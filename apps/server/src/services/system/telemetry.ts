import { readOrCreateSecretFile } from "@bb/secret-storage";
import type { ServerLogger } from "../../types.js";

/**
 * Anonymous usage telemetry.
 *
 * Sends a small set of product events (app starts, thread creation counts) to
 * PostHog so install/activation funnels can be measured. Identification is a
 * random per-install id persisted in the data dir — no user, host, project, or
 * workspace data is ever attached.
 *
 * Delivery is intentionally fire-and-forget: events are analytics, not
 * workflow state, so lost sends (offline, PostHog outage, process exit
 * mid-flight) are dropped without retry or persistence.
 *
 * A default public write-only PostHog key ships in @bb/config, but the caller
 * only enables telemetry for production server runs (the bb-app launcher and
 * desktop app set NODE_ENV=production; dev/source runs never send). Disabled
 * telemetry creates nothing, not even the install-id file. Opt out any run
 * with BB_TELEMETRY=false; override the key with BB_POSTHOG_API_KEY.
 */

const POSTHOG_INGESTION_URL = "https://us.i.posthog.com/capture/";
const TELEMETRY_ID_FILE_NAME = "telemetry-id";

export type TelemetryEvent =
  | { name: "app_started" }
  | {
      name: "thread_created";
      properties: {
        is_child_thread: boolean;
        provider: string;
      };
    };

export interface TelemetryService {
  capture(event: TelemetryEvent): void;
}

export interface CreateTelemetryServiceArgs {
  apiKey: string;
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

export async function createTelemetryService(
  args: CreateTelemetryServiceArgs,
): Promise<TelemetryService> {
  if (!args.enabled || args.apiKey.length === 0) {
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
      const body = JSON.stringify({
        api_key: args.apiKey,
        distinct_id: distinctId,
        event: event.name,
        properties: {
          ...commonProperties,
          ...("properties" in event ? event.properties : {}),
        },
        timestamp: new Date().toISOString(),
      });
      fetch(POSTHOG_INGESTION_URL, {
        body,
        headers: { "content-type": "application/json" },
        method: "POST",
      }).catch((error: unknown) => {
        args.logger.debug({ err: error }, "Telemetry event send failed");
      });
    },
  };
}
