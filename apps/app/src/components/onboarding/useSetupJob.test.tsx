// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSetupJob } from "./useSetupJob";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  shown: vi.fn(),
  expose: vi.fn(),
  decide: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/sdk", () => ({
  sdk: {
    system: {
      experimental_setupJob: api.read,
      experimental_setupJobShown: api.shown,
      exposeHoldout: api.expose,
      experimental_decideSetupJob: api.decide,
    },
  },
}));
vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: api.error },
}));

const offer = {
  arm: "a",
  suggestionAnalyticsId: "26ad88d4-6506-4ba9-a0ed-ccac606c638c",
  title: "Each weeknight, keep going on unfinished work",
  projectId: "project",
  projectName: "Project",
  providerName: "Agent",
  timezone: "UTC",
  status: "offered",
  automationId: null,
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return renderHook(useSetupJob, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  api.read.mockResolvedValue({ offer });
  api.shown.mockResolvedValue({ ok: true });
  api.expose.mockResolvedValue({ exposed: true });
  api.decide.mockResolvedValue({
    offer: { ...offer, status: "accepted", automationId: "auto_created" },
  });
});
afterEach(cleanup);

describe("setup job choice", () => {
  it("starts unticked, exposes the rendered offer, and dismisses on finish without opt-in", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.offer).not.toBeNull());
    expect(result.current.checked).toBe(false);
    expect(api.decide).not.toHaveBeenCalled();
    expect(api.expose).toHaveBeenCalledExactlyOnceWith(
      "app_setup_recurring_job",
    );
    const finish = vi.fn();
    await act(() => result.current.complete(finish));
    expect(api.decide).toHaveBeenCalledWith({
      suggestionAnalyticsId: offer.suggestionAnalyticsId,
      accepted: false,
    });
    expect(finish).toHaveBeenCalledTimes(1);
  });
  it("requires an explicit tick, keeps setup open on a creation failure, and allows opting out", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.offer).not.toBeNull());
    act(() => result.current.setChecked(true));
    expect(api.decide).not.toHaveBeenCalled();
    api.decide.mockRejectedValueOnce(new Error("Try again"));
    const finish = vi.fn();
    await act(() => result.current.complete(finish));
    expect(finish).not.toHaveBeenCalled();
    expect(api.error).toHaveBeenCalledWith("Try again");
    await act(() => result.current.complete(finish, false));
    expect(api.decide).toHaveBeenLastCalledWith({
      suggestionAnalyticsId: offer.suggestionAnalyticsId,
      accepted: false,
    });
    expect(finish).toHaveBeenCalledTimes(1);
  });
  it("does not record or decide an unavailable offer", async () => {
    api.read.mockResolvedValue({ offer: null });
    const { result } = setup();
    const finish = vi.fn();
    await act(() => result.current.complete(finish));
    expect(api.expose).not.toHaveBeenCalled();
    expect(api.shown).not.toHaveBeenCalled();
    expect(api.decide).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
  });
});
