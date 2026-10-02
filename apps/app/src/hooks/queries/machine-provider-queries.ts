import { useQuery } from "@tanstack/react-query";
import type { SystemMachineProvider } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { SERVER_SESSION_QUERY_POLICY } from "./query-policies";
import { systemMachineProvidersQueryKey } from "./query-keys";

const NO_MACHINE_PROVIDERS: readonly SystemMachineProvider[] = [];

export function useSystemMachineProviders(): {
  providers: readonly SystemMachineProvider[] | undefined;
} {
  const result = useQuery({
    queryKey: systemMachineProvidersQueryKey(),
    queryFn: () => sdk.hosts.experimental_listProviders(),
    ...SERVER_SESSION_QUERY_POLICY,
  });
  return {
    providers: result.isError ? NO_MACHINE_PROVIDERS : result.data,
  };
}
