import {
  systemSetupGuideFeaturedPluginsResponseSchema,
  systemSetupGuideResponseSchema,
  type SystemSetupGuideFeaturedPluginsResponse,
  type SystemSetupGuideResponse,
} from "@bb/server-contract";
import { fetchWithAppSurface } from "@/lib/app-surface";

export async function fetchSetupGuideAssignment(
  signal: AbortSignal,
): Promise<SystemSetupGuideResponse> {
  const response = await fetchWithAppSurface("/api/v1/system/setup-guide", {
    signal,
  });
  if (!response.ok) {
    throw new Error(`Setup guide request failed (${response.status})`);
  }
  return systemSetupGuideResponseSchema.parse(await response.json());
}

export async function fetchSetupGuideFeaturedPlugins(
  signal: AbortSignal,
): Promise<SystemSetupGuideFeaturedPluginsResponse> {
  const response = await fetchWithAppSurface(
    "/api/v1/system/setup-guide/featured-plugins",
    { signal },
  );
  if (!response.ok) {
    throw new Error(`Featured plugins request failed (${response.status})`);
  }
  return systemSetupGuideFeaturedPluginsResponseSchema.parse(
    await response.json(),
  );
}
