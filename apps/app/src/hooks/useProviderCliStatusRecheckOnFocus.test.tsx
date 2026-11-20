// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferredPromise } from "@bb/test-helpers";
import { useProviderCliStatusRecheckOnFocus } from "./useProviderCliStatusRecheckOnFocus";

const providerCliStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", () => ({
  sdk: { hosts: { providerCliStatus: providerCliStatusMock } },
}));

function renderRecheck(initial: { hostId: string | null; blocked: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook((props) => useProviderCliStatusRecheckOnFocus(props), {
    initialProps: initial,
    wrapper,
  });
}

async function returnToWindow() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
  providerCliStatusMock.mockReset();
});

describe("useProviderCliStatusRecheckOnFocus", () => {
  it("force-refreshes the host's CLI status on each return while blocked, one probe at a time", async () => {
    const firstProbe = createDeferredPromise<Record<string, never>>();
    providerCliStatusMock.mockReturnValueOnce(firstProbe.promise);
    providerCliStatusMock.mockResolvedValue({});
    renderRecheck({ hostId: "host-a", blocked: true });

    await returnToWindow();
    await returnToWindow();
    expect(providerCliStatusMock).toHaveBeenCalledTimes(1);
    expect(providerCliStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "host-a", refresh: true }),
    );

    await act(async () => firstProbe.resolve({}));
    await returnToWindow();
    expect(providerCliStatusMock).toHaveBeenCalledTimes(2);
  });

  it("does not probe on focus unless the composer is blocked", async () => {
    providerCliStatusMock.mockResolvedValue({});
    const { rerender } = renderRecheck({ hostId: "host-a", blocked: false });

    await returnToWindow();
    expect(providerCliStatusMock).not.toHaveBeenCalled();

    rerender({ hostId: "host-a", blocked: true });
    await returnToWindow();
    expect(providerCliStatusMock).toHaveBeenCalledTimes(1);

    rerender({ hostId: "host-a", blocked: false });
    await returnToWindow();
    expect(providerCliStatusMock).toHaveBeenCalledTimes(1);
  });
});
