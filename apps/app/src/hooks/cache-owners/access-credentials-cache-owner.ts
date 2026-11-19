import type { QueryClient } from "@tanstack/react-query";

export const accessCredentialsQueryKey = ["access", "credentials"] as const;

export function invalidateAccessCredentials(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: accessCredentialsQueryKey });
}
