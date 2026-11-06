import {
  systemSetupGuideResponseSchema,
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
