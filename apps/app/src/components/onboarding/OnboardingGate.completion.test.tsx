// @vitest-environment jsdom
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { defaultAppSettings, type AppSettings } from "@bb/domain";
import type { SystemConfigResponse } from "@bb/server-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markSystemConfigStale } from "@/hooks/cache-owners/system-config-cache-owner";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { createAppQueryClient } from "@/lib/query-client";
import { sdk } from "@/lib/sdk";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { OnboardingGate } from "./OnboardingGate";

const guide = vi.hoisted(() => ({ mounts: 0 }));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    system: {
      config: vi.fn(),
      updateGeneralSettings: vi.fn(),
    },
  },
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useHostListRealtimeSubscription: () => undefined,
  useSystemRealtimeSubscription: () => undefined,
}));
vi.mock("./OnboardingFlow", async () => {
  const { useEffect } = await import("react");
  return {
    OnboardingFlow: ({ onClose }: { onClose: () => void }) => {
      useEffect(() => {
        guide.mounts += 1;
      }, []);
      return (
        <button type="button" onClick={onClose}>
          Start using bb
        </button>
      );
    },
  };
});

const server = {
  completedAt: null as string | null,
  configReplies: [] as Array<() => void>,
  saveReplies: [] as Array<() => void>,
};

function storedSettings(): AppSettings {
  return { ...defaultAppSettings, onboardingCompletedAt: server.completedAt };
}

function answerConfigRequests(): Promise<void> {
  return act(async () => {
    for (const reply of server.configReplies.splice(0)) reply();
  });
}

function finishSaves(): Promise<void> {
  return act(async () => {
    for (const reply of server.saveReplies.splice(0)) reply();
  });
}

function AppShell() {
  const settings = useSystemConfig().data?.generalSettings;
  const updateSettings = useUpdateGeneralSettings();
  return (
    <button
      type="button"
      onClick={() => {
        if (settings === undefined) return;
        updateSettings.mutate({ ...settings, onboardingCompletedAt: null });
      }}
    >
      Replay setup guide
    </button>
  );
}

function renderGate(queryClient: QueryClient) {
  render(
    <QueryClientProvider client={queryClient}>
      <OnboardingGate>
        <AppShell />
      </OnboardingGate>
    </QueryClientProvider>,
  );
}

function createTestQueryClient(): QueryClient {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
    showMutationErrorToasts: false,
  });
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({ generalSettings: storedSettings() }),
  );
  return queryClient;
}

beforeEach(() => {
  window.localStorage.clear();
  guide.mounts = 0;
  server.completedAt = null;
  vi.mocked(sdk.system.config).mockImplementation(() => {
    const config = makeSystemConfig({ generalSettings: storedSettings() });
    const reply = createDeferredPromise<SystemConfigResponse>();
    server.configReplies.push(() => reply.resolve(config));
    return reply.promise;
  });
  vi.mocked(sdk.system.updateGeneralSettings).mockImplementation((input) => {
    const reply = createDeferredPromise<AppSettings>();
    server.saveReplies.push(() => {
      server.completedAt = input.onboardingCompletedAt ?? null;
      reply.resolve(storedSettings());
    });
    return reply.promise;
  });
});

afterEach(() => {
  cleanup();
  server.configReplies.length = 0;
  server.saveReplies.length = 0;
  vi.clearAllMocks();
});

describe("OnboardingGate completion against the settings cache", () => {
  it("keeps the guide closed when a config read from before the save lands while the save is in flight", async () => {
    const queryClient = createTestQueryClient();
    renderGate(queryClient);
    await screen.findByText("Start using bb");
    markSystemConfigStale(queryClient);

    fireEvent.click(screen.getByText("Start using bb"));
    await vi.waitFor(() =>
      expect(sdk.system.updateGeneralSettings).toHaveBeenCalledTimes(1),
    );
    expect(sdk.system.config).toHaveBeenCalledTimes(1);

    await answerConfigRequests();
    expect(screen.queryByText("Start using bb")).toBeNull();
    expect(screen.getByText("Replay setup guide")).toBeTruthy();

    await finishSaves();
    await vi.waitFor(() => expect(server.configReplies).toHaveLength(1));
    await answerConfigRequests();

    expect(
      queryClient.getQueryData<SystemConfigResponse>(systemConfigQueryKey())
        ?.generalSettings.onboardingCompletedAt,
    ).toBe(server.completedAt);
    expect(server.completedAt).not.toBeNull();
    expect(screen.queryByText("Start using bb")).toBeNull();
    expect(guide.mounts).toBe(1);
  });

  it("shows the guide again when Settings clears the completion after a close in the same session", async () => {
    const queryClient = createTestQueryClient();
    renderGate(queryClient);
    fireEvent.click(await screen.findByText("Start using bb"));
    await vi.waitFor(() => expect(server.saveReplies).toHaveLength(1));
    await finishSaves();
    await vi.waitFor(() => expect(server.configReplies).toHaveLength(1));
    await answerConfigRequests();
    expect(server.completedAt).not.toBeNull();

    fireEvent.click(screen.getByText("Replay setup guide"));
    await vi.waitFor(() => expect(server.saveReplies).toHaveLength(1));
    await finishSaves();
    await vi.waitFor(() => expect(server.configReplies).toHaveLength(1));
    await answerConfigRequests();

    expect(server.completedAt).toBeNull();
    expect(await screen.findByText("Start using bb")).toBeTruthy();
    expect(screen.queryByText("Replay setup guide")).toBeNull();
    expect(guide.mounts).toBe(2);
  });
});
