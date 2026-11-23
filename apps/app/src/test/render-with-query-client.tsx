import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render as renderWithoutQueryClient,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";

interface RenderWithQueryClientOptions extends Omit<RenderOptions, "wrapper"> {
  queryClient?: QueryClient;
}

export function render(
  ui: ReactElement,
  { queryClient, ...options }: RenderWithQueryClientOptions = {},
): RenderResult {
  const client =
    queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithoutQueryClient(ui, {
    ...options,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
