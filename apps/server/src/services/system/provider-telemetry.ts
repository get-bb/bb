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

export function listShippedProviderIds(): string[] {
  return [...shippedProviderIds];
}

export function reportedProviderId(providerId: string): string {
  return shippedProviderIds.has(providerId) ? providerId : "other";
}

function withReportedResourceId<
  Event extends { properties: { resource_id?: string } },
>(event: Event): Event {
  const resourceId = event.properties.resource_id;
  if (resourceId === undefined) return event;
  return {
    ...event,
    properties: {
      ...event.properties,
      resource_id: reportedProviderId(resourceId),
    },
  };
}

export function withReportedProviderId(
  event: RecordTelemetryEventRequest,
): RecordTelemetryEventRequest {
  switch (event.name) {
    case "onboarding_sign_in":
    case "new_thread_composer_shown":
    case "new_thread_draft_started":
      return withReportedResourceId(event);
    case "onboarding_operation":
      return event.properties.step === "agent"
        ? withReportedResourceId(event)
        : event;
    default:
      return event;
  }
}
