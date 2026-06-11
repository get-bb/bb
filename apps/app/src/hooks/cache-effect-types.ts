import type { QueryClient, QueryKey } from "@tanstack/react-query";

export interface QueryClientArg {
  queryClient: QueryClient;
}

export interface ProjectArg extends QueryClientArg {
  projectId: string;
}

export interface ThreadArg extends QueryClientArg {
  threadId: string;
}

export interface EnvironmentArg extends QueryClientArg {
  environmentId: string;
}

export interface OptionalEnvironmentArg extends QueryClientArg {
  environmentId: string | null | undefined;
}

export interface QueryKeysArg extends QueryClientArg {
  queryKeys: readonly QueryKey[];
}
