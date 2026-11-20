// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { useNewThreadProviderFallback } from "./provider-fallback-queries";

const RESETS_LATER = new Date(Date.now() + 60 * 60_000).toISOString();

const mocks = vi.hoisted(() => {
  const state: {
    fallbackProviderId: string | null;
    usageLimits: Mock<
      (args: { providerId: string }) => Promise<Record<string, unknown>>
    >;
  } = { fallbackProviderId: "codex", usageLimits: vi.fn() };
  return state;
});

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { usageLimits: mocks.usageLimits } },
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: { fallbackProviderId: mocks.fallbackProviderId } },
  }),
}));

function usage(usedPercent: number) {
  return {
    status: "ok",
    accountEmail: null,
    planLabel: null,
    windows: [{ label: "Weekly limit", usedPercent, resetsAt: RESETS_LATER }],
  };
}

function renderFallback(args: { enabled?: boolean; hostId?: string | null }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useNewThreadProviderFallback({
        enabled: args.enabled ?? true,
        hostId: args.hostId ?? "host-1",
        providerId: "claude-code",
        model: "claude-opus-5-5",
        fallbackSelectable: (providerId) => providerId === "codex",
      }),
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  mocks.usageLimits.mockReset();
  mocks.fallbackProviderId = "codex";
});

describe("useNewThreadProviderFallback", () => {
  it("reports the fallback when the default is out of usage on the host", async () => {
    mocks.usageLimits.mockImplementation(async ({ providerId }) => ({
      [providerId]: usage(providerId === "claude-code" ? 100 : 10),
    }));
    const { result } = renderFallback({});
    await waitFor(() =>
      expect(result.current).toMatchObject({
        providerId: "codex",
        fromProviderId: "claude-code",
        exhausted: { label: "Weekly limit" },
      }),
    );
    expect(mocks.usageLimits).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "host-1", providerId: "claude-code" }),
    );
  });

  it("reads no usage when the provider was picked or no fallback is set", async () => {
    mocks.usageLimits.mockResolvedValue({ "claude-code": usage(100) });
    expect(renderFallback({ enabled: false }).result.current).toBeNull();
    mocks.fallbackProviderId = null;
    expect(renderFallback({}).result.current).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.usageLimits).not.toHaveBeenCalled();
  });
});
