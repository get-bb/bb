import {
  MutationObserver,
  QueryObserver,
  type QueryClient,
} from "@tanstack/react-query";
import { createDeferredPromise, createMemoryStorage } from "@bb/test-helpers";
import type { SystemConfigResponse } from "@bb/server-contract";
import {
  defaultAppSettings,
  type AppKeybindingOverrides,
  type AppKeybindings,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  modelCatalogCacheKey,
  readCachedModelCatalog,
  writeCachedModelCatalog,
} from "@/lib/model-catalog-cache";
import { createAppQueryClient } from "@/lib/query-client";
import { sdk } from "@/lib/sdk";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import {
  systemConfigQueryKey,
  systemExecutionOptionsQueryKey,
  systemProvidersQueryKey,
  threadTimelineQueryKey,
  threadTimelineTurnSummaryDetailsQueryKey,
} from "../queries/query-keys";
import {
  generalSettingsMutationOptions,
  keyboardSettingsMutationOptions,
} from "./settings-mutations";

vi.mock("@/lib/sdk", () => {
  return {
    sdk: {
      system: {
        updateGeneralSettings: vi.fn(),
        updateKeyboardSettings: vi.fn(),
      },
    },
  };
});

const defaultKeybindings: AppKeybindings = [
  {
    command: "thread.new",
    desktopOnly: false,
    shortcut: {
      key: "n",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  },
];

function systemConfig(): SystemConfigResponse {
  return makeSystemConfig({
    keybindings: defaultKeybindings,
    defaultKeybindings,
  });
}

function createTestQueryClient(): QueryClient {
  return createAppQueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
    showMutationErrorToasts: false,
  });
}

function generalSettingsSave(queryClient: QueryClient) {
  return new MutationObserver(
    queryClient,
    generalSettingsMutationOptions(queryClient),
  );
}

function keyboardSettingsSave(queryClient: QueryClient) {
  return new MutationObserver(
    queryClient,
    keyboardSettingsMutationOptions(queryClient),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("general settings mutation", () => {
  it("invalidates config and timeline projections and leaves model catalogs alone for a non-streamer write", async () => {
    const queryClient = createTestQueryClient();
    const configKey = systemConfigQueryKey();
    const timelineKey = threadTimelineQueryKey("thread-1");
    const summaryKey = threadTimelineTurnSummaryDetailsQueryKey({
      itemId: null,
      threadId: "thread-1",
      turnId: "turn-1",
      sourceSeqStart: 1,
      sourceSeqEnd: 2,
    });
    const executionOptionsKey = systemExecutionOptionsQueryKey({
      environmentId: null,
      hostId: "host-1",
      providerId: "claude-code",
    });
    const providersKey = systemProvidersQueryKey();
    queryClient.setQueryData(configKey, systemConfig());
    queryClient.setQueryData(timelineKey, {});
    queryClient.setQueryData(summaryKey, {});
    queryClient.setQueryData(executionOptionsKey, { models: ["cached"] });
    queryClient.setQueryData(providersKey, [{ id: "claude-code" }]);
    const nextSettings = {
      ...defaultAppSettings,
      showDiagnosticEvents: true,
    };
    vi.mocked(sdk.system.updateGeneralSettings).mockResolvedValue(nextSettings);

    await generalSettingsSave(queryClient).mutate(nextSettings);

    expect(queryClient.getQueryState(configKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(timelineKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(summaryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(executionOptionsKey)?.isInvalidated).toBe(
      false,
    );
    expect(queryClient.getQueryData(executionOptionsKey)).toEqual({
      models: ["cached"],
    });
    expect(queryClient.getQueryState(providersKey)?.isInvalidated).toBe(false);
  });

  it.each(["success", "failure"])(
    "keeps the save pending through a provider refetch ending in %s",
    async (outcome) => {
      const queryClient = createTestQueryClient();
      const providersKey = systemProvidersQueryKey();
      const nextSettings = {
        ...defaultAppSettings,
        providerOrder: ["beta", "alpha"],
      };
      queryClient.setQueryData(systemConfigQueryKey(), systemConfig());
      queryClient.setQueryData(providersKey, ["alpha", "beta"]);
      const refetch = createDeferredPromise<string[]>();
      const queryFn = vi.fn(() => refetch.promise);
      vi.mocked(sdk.system.updateGeneralSettings).mockResolvedValue(
        nextSettings,
      );
      const providers = new QueryObserver(queryClient, {
        queryKey: providersKey,
        queryFn,
        staleTime: Infinity,
      });
      const unsubscribe = providers.subscribe(() => {});
      const save = generalSettingsSave(queryClient);
      const settled = vi.fn();
      try {
        const saving = save.mutate(nextSettings).then(settled);
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce());
        await Promise.resolve();
        expect(save.getCurrentResult().isPending).toBe(true);
        expect(settled).not.toHaveBeenCalled();
        expect(providers.getCurrentResult().data).toEqual(["alpha", "beta"]);

        if (outcome === "success") refetch.resolve(["beta", "alpha"]);
        else refetch.reject(new Error("Provider directory unavailable"));
        await saving;

        expect(save.getCurrentResult().isSuccess).toBe(true);
        expect(settled).toHaveBeenCalledOnce();
        expect(providers.getCurrentResult().data).toEqual(
          outcome === "success" ? ["beta", "alpha"] : ["alpha", "beta"],
        );
        expect(providers.getCurrentResult().isError).toBe(
          outcome === "failure",
        );
      } finally {
        unsubscribe();
      }
    },
  );

  it("shows rapid patches at once and sends each write with every earlier patch", async () => {
    const queryClient = createTestQueryClient();
    const configKey = systemConfigQueryKey();
    queryClient.setQueryData(configKey, systemConfig());
    const firstWrite = createDeferredPromise<typeof defaultAppSettings>();
    const secondWrite = createDeferredPromise<typeof defaultAppSettings>();
    vi.mocked(sdk.system.updateGeneralSettings)
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    const save = generalSettingsSave(queryClient);

    const firstSave = save.mutate({ showGitChanges: false });
    const secondSave = save.mutate({ confirmThreadArchive: false });
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData<SystemConfigResponse>(configKey)
          ?.generalSettings,
      ).toMatchObject({ showGitChanges: false, confirmThreadArchive: false }),
    );
    expect(sdk.system.updateGeneralSettings).toHaveBeenCalledOnce();

    firstWrite.resolve({ ...defaultAppSettings, showGitChanges: false });
    await firstSave;
    await vi.waitFor(() =>
      expect(sdk.system.updateGeneralSettings).toHaveBeenCalledTimes(2),
    );
    expect(queryClient.getQueryState(configKey)?.isInvalidated).toBe(false);
    expect(
      vi.mocked(sdk.system.updateGeneralSettings).mock.calls[1]?.[0],
    ).toMatchObject({ showGitChanges: false, confirmThreadArchive: false });

    secondWrite.resolve({
      ...defaultAppSettings,
      showGitChanges: false,
      confirmThreadArchive: false,
    });
    await secondSave;
    expect(queryClient.getQueryState(configKey)?.isInvalidated).toBe(true);
  });

  it("rolls back only the failed patch and keeps a later pending one", async () => {
    const queryClient = createTestQueryClient();
    const configKey = systemConfigQueryKey();
    queryClient.setQueryData(configKey, systemConfig());
    const firstWrite = createDeferredPromise<typeof defaultAppSettings>();
    vi.mocked(sdk.system.updateGeneralSettings)
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(new Promise(() => {}));
    const save = generalSettingsSave(queryClient);

    const firstSave = save.mutate({ showGitChanges: false });
    void save.mutate({ confirmThreadArchive: false });
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData<SystemConfigResponse>(configKey)
          ?.generalSettings.confirmThreadArchive,
      ).toBe(false),
    );
    firstWrite.reject(new Error("write failed"));
    await expect(firstSave).rejects.toThrow("write failed");
    await vi.waitFor(() =>
      expect(sdk.system.updateGeneralSettings).toHaveBeenCalledTimes(2),
    );

    expect(
      queryClient.getQueryData<SystemConfigResponse>(configKey)
        ?.generalSettings,
    ).toMatchObject({ showGitChanges: true, confirmThreadArchive: false });
    expect(
      vi.mocked(sdk.system.updateGeneralSettings).mock.calls[1]?.[0],
    ).toMatchObject({ showGitChanges: true, confirmThreadArchive: false });
  });

  it("drops cached model catalogs when streamer mode flips", async () => {
    vi.stubGlobal("window", { localStorage: createMemoryStorage() });
    const queryClient = createTestQueryClient();
    const executionOptionsKey = systemExecutionOptionsQueryKey({
      environmentId: null,
      hostId: "host-1",
      providerId: "claude-code",
    });
    const catalogCacheKey = modelCatalogCacheKey({
      environmentId: null,
      hostId: "host-1",
      providerId: "claude-code",
    });
    queryClient.setQueryData(systemConfigQueryKey(), systemConfig());
    queryClient.setQueryData(executionOptionsKey, { models: ["secret"] });
    writeCachedModelCatalog(catalogCacheKey, {
      models: [],
      selectedOnlyModels: [],
    });
    expect(readCachedModelCatalog(catalogCacheKey)).not.toBeNull();
    const nextSettings = { ...defaultAppSettings, streamerMode: true };
    vi.mocked(sdk.system.updateGeneralSettings).mockResolvedValue(nextSettings);

    await generalSettingsSave(queryClient).mutate(nextSettings);

    await vi.waitFor(() =>
      expect(queryClient.getQueryData(executionOptionsKey)).toBeUndefined(),
    );
    expect(readCachedModelCatalog(catalogCacheKey)).toBeNull();
  });
});

describe("keyboard settings mutation", () => {
  it("updates resolved system config before the request completes", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(systemConfigQueryKey(), systemConfig());
    const request = createDeferredPromise<AppKeybindingOverrides>();
    vi.mocked(sdk.system.updateKeyboardSettings).mockReturnValue(
      request.promise,
    );
    const overrides: AppKeybindingOverrides = [
      {
        command: "thread.new",
        shortcut: {
          key: "u",
          mod: true,
          meta: false,
          control: false,
          alt: false,
          shift: true,
        },
      },
    ];
    const save = keyboardSettingsSave(queryClient);

    const saving = save.mutate(overrides);
    await vi.waitFor(() => {
      expect(
        queryClient.getQueryData<SystemConfigResponse>(systemConfigQueryKey())
          ?.keybindings[0]?.shortcut,
      ).toMatchObject({ key: "u", shift: true });
    });

    request.resolve(overrides);
    await saving;
    expect(save.getCurrentResult().isSuccess).toBe(true);
  });

  it("restores resolved system config when the request fails", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(systemConfigQueryKey(), systemConfig());
    vi.mocked(sdk.system.updateKeyboardSettings).mockRejectedValue(
      new Error("write failed"),
    );

    await expect(
      keyboardSettingsSave(queryClient).mutate([
        { command: "thread.new", shortcut: null },
      ]),
    ).rejects.toThrow("write failed");

    const restored = queryClient.getQueryData<SystemConfigResponse>(
      systemConfigQueryKey(),
    );
    expect(restored?.keybindingOverrides).toEqual([]);
    expect(restored?.keybindings).toEqual(defaultKeybindings);
  });
});
