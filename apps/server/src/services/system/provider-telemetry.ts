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
      return withReportedResourceId(event);
    case "onboarding_agent_state": {
      const statuses = event.properties.agent_statuses;
      if (statuses === undefined) return event;
      return {
        ...event,
        properties: {
          ...event.properties,
          agent_statuses: Object.fromEntries(
            Object.entries(statuses).filter(([providerId]) =>
              shippedProviderIds.has(providerId),
            ),
          ),
        },
      };
    }
    case "onboarding_operation":
      return event.properties.step === "agent"
        ? withReportedResourceId(event)
        : event;
    default:
      return event;
  }
}
