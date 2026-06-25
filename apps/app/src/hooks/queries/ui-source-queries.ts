import { useQuery, type QueryKey } from "@tanstack/react-query";

/**
 * UI-source status, mirrored from the server's UiSourceState. Not in the typed
 * server contract — the `/api/v1/ui/*` routes are plain server-policy glue — so
 * this is fetched directly and typed locally.
 */
export interface UiSourceStatus {
  active: "prod" | "fork";
  status: "idle" | "building" | "ready" | "error" | "needs-rebase";
  seeded: boolean;
  lastBuiltAt: string | null;
  error: string | null;
  version: string | null;
  conflictFiles: string[];
  /** False when the UI-forking experiment is off — nothing to surface. */
  enabled: boolean;
}

export function uiSourceStatusQueryKey(): QueryKey {
  return ["ui-source-status"];
}

async function fetchUiSourceStatus(): Promise<UiSourceStatus | null> {
  const response = await fetch("/api/v1/ui/status");
  // 404 = feature not enabled on this server (no build toolchain). Treat as
  // "nothing to surface" rather than an error.
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as UiSourceStatus;
}

export function useUiSourceStatus() {
  return useQuery({
    queryKey: uiSourceStatusQueryKey(),
    queryFn: fetchUiSourceStatus,
    staleTime: 30_000,
  });
}
