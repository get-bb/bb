import type { QueryClient } from "@tanstack/react-query";

export const applicationLinkApprovalsQueryKey = [
  "device-application-link-approvals",
] as const;

export function writeApplicationLinkApprovals(
  queryClient: QueryClient,
  schemes: string[],
): void {
  queryClient.setQueryData(applicationLinkApprovalsQueryKey, schemes);
}

export function invalidateApplicationLinkApprovals(
  queryClient: QueryClient,
): void {
  void queryClient.invalidateQueries({
    queryKey: applicationLinkApprovalsQueryKey,
  });
}
