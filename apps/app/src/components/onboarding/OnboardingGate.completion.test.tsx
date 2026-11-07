// @vitest-environment jsdom
import {
  defaultScheduler,
  notifyManager,
  QueryClientProvider,
  type QueryClient,
} from "@tanstack/react-query";
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
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markSystemConfigStale } from "@/hooks/cache-owners/system-config-cache-owner";
import { useUpdateGeneralSettings } from "@/hooks/mutations/settings-mutations";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { createAppQueryClient } from "@/lib/query-client";
import { sdk } from "@/lib/sdk";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { OnboardingGate } from "./OnboardingGate";
import { recordTelemetryEvent } from "./onboarding-telemetry";

const guide = vi.hoisted(
  (): { mounts: number; variant: "control" | "new" } => ({
    mounts: 0,
    variant: "control",
  }),
);
const app = { mounts: 0 };

vi.mock("@/lib/sdk", () => ({
  sdk: {
    hosts: {
      list: vi.fn(() => Promise.resolve([])),
    },
    system: {
      config: vi.fn(),
      updateGeneralSettings: vi.fn(),
    },
  },
}));
vi.mock("@/hooks/queries/setup-guide-requests", () => ({
  fetchSetupGuideAssignment: vi.fn(() =>
    Promise.resolve({ variant: guide.variant }),
  ),
}));
vi.mock("./onboarding-telemetry", () => ({ recordTelemetryEvent: vi.fn() }));
vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useHostListRealtimeSubscription: () => undefined,
  useSystemRealtimeSubscription: () => undefined,
}));
vi.mock("./OnboardingFlow", async () => {
  const { useEffect } = await import("react");
  return {
    OnboardingFlow: ({
      onClose,
    }: {
      onClose: (lastStep: "devices") => void;
    }) => {
      useEffect(() => {
        guide.mounts += 1;
      }, []);
      return (
        <button type="button" onClick={() => onClose("devices")}>
          Start using bb
        </button>
      );
    },
  };
});

const server = {
  completedAt: null as string | null,
  failSaves: false,
  configReplies: [] as Array<() => void>,
  saveReplies: [] as Array<() => void>,
};

function storedSettings(): AppSettings {
  return { ...defaultAppSettings, onboardingCompletedAt: server.completedAt };
}

function settle(replies: Array<() => void> = []): Promise<void> {
  return act(async () => {
    for (const reply of replies.splice(0)) reply();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function guideButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Start using bb" });
}

async function closeGuide(): Promise<void> {
  const button = guideButton();
  if (button === null) throw new Error("The guide is not showing.");
  fireEvent.click(button);
  await settle();
}

function currentCompletedAt(queryClient: QueryClient): string | null {
  const config = queryClient.getQueryData<SystemConfigResponse>(
    systemConfigQueryKey(),
  );
  return config?.generalSettings.onboardingCompletedAt ?? null;
}

function AppShell() {
  useEffect(() => {
    app.mounts += 1;
  }, []);
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
  notifyManager.setScheduler((callback) => callback());
  window.localStorage.clear();
  guide.mounts = 0;
  guide.variant = "control";
  app.mounts = 0;
  server.completedAt = null;
  server.failSaves = false;
  vi.mocked(sdk.system.config).mockImplementation(() => {
    const config = makeSystemConfig({ generalSettings: storedSettings() });
    const reply = createDeferredPromise<SystemConfigResponse>();
    server.configReplies.push(() => reply.resolve(config));
    return reply.promise;
  });
  vi.mocked(sdk.system.updateGeneralSettings).mockImplementation((input) => {
    const reply = createDeferredPromise<AppSettings>();
    server.saveReplies.push(() => {
      if (server.failSaves) {
        reply.reject(new Error("save failed"));
        return;
      }
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
  notifyManager.setScheduler(defaultScheduler);
});

describe.each(["control", "new"] as const)(
  "OnboardingGate completion against the settings cache (%s guide)",
  (variant) => {
    beforeEach(() => {
      guide.variant = variant;
    });

    it("keeps the guide closed when a config read from before the save lands while the save is in flight", async () => {
      const queryClient = createTestQueryClient();
      renderGate(queryClient);
      await screen.findByText("Start using bb");
      markSystemConfigStale(queryClient);

      await closeGuide();
      expect(sdk.system.updateGeneralSettings).toHaveBeenCalledTimes(1);
      expect(server.configReplies).toHaveLength(1);

      await settle(server.configReplies);
      expect(currentCompletedAt(queryClient)).toBeNull();
      expect(guideButton()).toBeNull();
      expect(screen.getByText("Replay setup guide")).toBeTruthy();

      await settle(server.saveReplies);
      expect(server.configReplies).toHaveLength(1);
      await settle(server.configReplies);

      expect(server.completedAt).not.toBeNull();
      expect(currentCompletedAt(queryClient)).toBe(server.completedAt);
      expect(guideButton()).toBeNull();
      expect(screen.getByText("Replay setup guide")).toBeTruthy();
      expect(guide.mounts).toBe(1);
      expect(app.mounts).toBe(1);
    });

    it("shows the guide again when Settings clears the completion after a close in the same session", async () => {
      const queryClient = createTestQueryClient();
      renderGate(queryClient);
      await screen.findByText("Start using bb");
      await closeGuide();
      await settle(server.saveReplies);
      await settle(server.configReplies);
      expect(server.completedAt).not.toBeNull();
      expect(screen.getByText("Replay setup guide")).toBeTruthy();

      fireEvent.click(screen.getByText("Replay setup guide"));
      await settle();
      await settle(server.saveReplies);
      await settle(server.configReplies);

      expect(server.completedAt).toBeNull();
      expect(currentCompletedAt(queryClient)).toBeNull();
      expect(guideButton()).not.toBeNull();
      expect(screen.queryByText("Replay setup guide")).toBeNull();
      expect(guide.mounts).toBe(2);
    });

    it("shows the guide again when its completion save fails, and Start using bb saves again", async () => {
      const queryClient = createTestQueryClient();
      renderGate(queryClient);
      await screen.findByText("Start using bb");
      server.failSaves = true;

      await closeGuide();
      expect(guideButton()).toBeNull();
      await settle(server.saveReplies);
      await settle(server.configReplies);

      expect(server.completedAt).toBeNull();
      expect(currentCompletedAt(queryClient)).toBeNull();
      expect(guideButton()).not.toBeNull();
      expect(guide.mounts).toBe(variant === "new" ? 1 : 2);

      server.failSaves = false;
      await closeGuide();
      await settle(server.saveReplies);
      await settle(server.configReplies);

      expect(sdk.system.updateGeneralSettings).toHaveBeenCalledTimes(2);
      expect(server.completedAt).not.toBeNull();
      expect(guideButton()).toBeNull();
      expect(screen.getByText("Replay setup guide")).toBeTruthy();
    });

    it("records a failed completion save from the last step", async () => {
      const queryClient = createTestQueryClient();
      renderGate(queryClient);
      await screen.findByText("Start using bb");
      server.failSaves = true;

      await closeGuide();
      expect(recordTelemetryEvent).not.toHaveBeenCalled();
      await settle(server.saveReplies);

      expect(recordTelemetryEvent).toHaveBeenCalledExactlyOnceWith({
        name: "onboarding_operation",
        properties: {
          entry: "first_run",
          step: "devices",
          operation: "finish",
          outcome: "failed",
          failure_reason: "other",
        },
      });
    });
  },
);
