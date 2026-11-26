import { QueryClient, useQuery } from "@tanstack/react-query";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { automationRpcContract } from "./src/rpc.js";
import type { AutomationDetailReadResult } from "./src/rpc-types";

export const PANEL_PATH = "automations";

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface DetailRoute {
  projectId: string;
  automationId: string;
}

export interface ParsedDetailRoute {
  route: DetailRoute;
  editing: boolean;
}

export function parseSubPath(subPath: string): ParsedDetailRoute | null {
  const parts = subPath.split("/").filter((p) => p.length > 0);
  if (parts.length === 2 || (parts.length === 3 && parts[2] === "edit")) {
    return {
      route: { projectId: parts[0], automationId: parts[1] },
      editing: parts[2] === "edit",
    };
  }
  return null;
}

export interface AutomationSignal {
  projectId: string;
  kind: "automations-changed" | "automation-runs-changed";
}

export function asSignal(payload: unknown): AutomationSignal | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as { projectId?: unknown; kind?: unknown };
  if (
    typeof record.projectId !== "string" ||
    (record.kind !== "automations-changed" &&
      record.kind !== "automation-runs-changed")
  ) {
    return null;
  }
  return { projectId: record.projectId, kind: record.kind };
}

export const automationQueryClient = new QueryClient();

export function useAutomation(route: DetailRoute | null): {
  automation: AutomationDetailReadResult | null;
  error: string | null;
  refetch: () => void;
} {
  const rpc = useRpc<typeof automationRpcContract>();
  const queryKey = [
    "automation",
    route?.projectId ?? null,
    route?.automationId ?? null,
  ];
  const query = useQuery(
    {
      queryKey,
      queryFn: () => {
        if (!route) throw new Error("Automation route required");
        return rpc.call("automations_get", route);
      },
      enabled: route !== null,
      staleTime: 30_000,
      retry: false,
    },
    automationQueryClient,
  );
  useRealtime("automations", (payload) => {
    const signal = asSignal(payload);
    if (route && signal?.projectId === route.projectId) {
      void automationQueryClient.invalidateQueries(
        { queryKey },
        { cancelRefetch: false },
      );
    }
  });
  return {
    automation: query.data ?? null,
    error: query.error ? errorText(query.error) : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
