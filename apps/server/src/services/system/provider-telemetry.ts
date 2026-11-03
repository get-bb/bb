import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginPackageJsonSchema } from "@bb/domain";
import type { RecordTelemetryEventRequest } from "@bb/server-contract";
import { listBundledPluginRegistrations } from "../plugins/builtin-registry.js";

const shippedProviderIds = new Set<string>();
for (const { rootDir } of listBundledPluginRegistrations()) {
  try {
    const manifest = pluginPackageJsonSchema.parse(
      JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")),
    );
    for (const provider of manifest.bb.experimental_providers ?? []) {
      shippedProviderIds.add(provider.id);
    }
  } catch {}
}

export function reportedProviderId(providerId: string): string {
  return shippedProviderIds.has(providerId) ? providerId : "other";
}

export function withReportedProviderId(
  event: RecordTelemetryEventRequest,
): RecordTelemetryEventRequest {
  if (event.name === "onboarding_sign_in") {
    return {
      ...event,
      properties: {
        ...event.properties,
        resource_id: reportedProviderId(event.properties.resource_id),
      },
    };
  }
  if (
    event.name === "onboarding_operation" &&
    event.properties.step === "agent" &&
    event.properties.resource_id !== undefined
  ) {
    return {
      ...event,
      properties: {
        ...event.properties,
        resource_id: reportedProviderId(event.properties.resource_id),
      },
    };
  }
  return event;
}
