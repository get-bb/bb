import {
  QueryObserver,
  type QueryClient,
  type QueryKey,
  type QueryObserverOptions,
} from "@tanstack/react-query";
import type { AvailableModel } from "@bb/domain";
import type {
  SystemExecutionOptionsResponse,
  SystemProviderStatesResponse,
} from "@bb/server-contract";
import type { ProviderInfo } from "@bb/domain";
import { createMemoryStorage } from "@bb/test-helpers";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  hostProviderCliStatusQueryKey,
  systemExecutionOptionsQueryKey,
  systemProviderStatesQueryKey,
  systemProvidersQueryKey,
} from "./query-keys";
import {
  hostProviderCliStatusQueryOptions,
  liveSystemExecutionOptionsQueryOptions,
  prefetchSystemExecutionOptions,
  resolveSystemProviderInfo,
  systemProviderStatesQueryOptions,
  systemProvidersQueryOptions,
} from "./system-queries";

vi.mock("@/lib/sdk", () => ({
  BbHttpError: class BbHttpError extends Error {},
  sdk: {
    hosts: { providerCliStatus: vi.fn() },
    providers: { list: vi.fn() },
    system: {
      executionOptions: vi.fn(),
      providerStates: vi.fn(),
    },
  },
}));

const EXECUTION_OPTIONS_RESPONSE: SystemExecutionOptionsResponse = {
  providers: [],
  models: [],
  selectedOnlyModels: [],
  permissionCeiling: "full",
  modelLoadError: null,
};

const PROVIDER_CLI_STATUS_RESPONSE = {} as ProviderCliStatusResponse;
const PROVIDERS: ProviderInfo[] = [];

function providerStates(providerId: string): SystemProviderStatesResponse {
  return {
    providers: [
      {
        providerId,
        displayName: providerId,
        status: "ready",
        statusMessage: null,
        planLabel: null,
        accountEmail: null,
        installedVersion: null,
        minimumSupportedVersion: null,
        canInstall: false,
        canUpdate: false,
        loginCommand: null,
        localLoginCommand: null,
      },
    ],
  };
}

let storage: Storage;
const unsubscribes: Array<() => void> = [];

function observe<TData, TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  options: QueryObserverOptions<TData, Error, TData, TData, TQueryKey>,
): QueryObserver<TData, Error, TData, TData, TQueryKey> {
  const observer = new QueryObserver(queryClient, options);
  const unsubscribe = observer.subscribe(() => {});
  unsubscribes.push(unsubscribe);
  return observer;
}

function stopObserving(): void {
  for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
}

beforeEach(() => {
  storage = createMemoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  stopObserving();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("useSystemProviderInfo", () => {
  it("uses capabilities already loaded by the composer while the provider roster loads", async () => {
    const provider = makeProviderInfo({
      id: "codex",
      displayName: "Codex",
      logoUrl: null,
      capabilities: {
        supportsThreadArchive: true,
        supportsThreadRename: true,
        supportsServiceTier: true,
        supportsNativeUserQuestion: false,
        supportsFork: true,
        supportsSessionRewind: true,
        modelCatalogScope: "workspace",
        permissionModes: ["accept-edits", "auto", "full"],
      },
    });
    vi.mocked(sdk.providers.list).mockImplementation(
      () => new Promise(() => undefined),
    );
    const { queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(
      systemExecutionOptionsQueryKey({
        environmentId: "env-remote",
        hostId: null,
        providerId: "codex",
      }),
      { ...EXECUTION_OPTIONS_RESPONSE, providers: [provider] },
    );

    const observer = observe(
      queryClient,
      systemProvidersQueryOptions({ environmentId: "env-remote" }),
    );

    expect(
      resolveSystemProviderInfo({
        providers: observer.getCurrentResult().data,
        providerId: "codex",
        queryClient,
      }),
    ).toBe(provider);
    await vi.waitFor(() => {
      expect(sdk.providers.list).toHaveBeenCalledOnce();
    });
  });

  it("loads routed provider capabilities without waiting for model discovery", async () => {
    const providers: ProviderInfo[] = [
      makeProviderInfo({
        id: "codex",
        displayName: "Codex",
        logoUrl: null,
        capabilities: {
          supportsServiceTier: true,
          supportsSessionRewind: true,
        },
      }),
    ];
    vi.mocked(sdk.providers.list).mockResolvedValue(providers);
    vi.mocked(sdk.system.executionOptions).mockImplementation(
      () => new Promise(() => undefined),
    );
    const { queryClient } = createQueryClientTestHarness();

    const observer = observe(
      queryClient,
      systemProvidersQueryOptions({ environmentId: "env-remote" }),
    );

    await vi.waitFor(() => {
      expect(
        resolveSystemProviderInfo({
          providers: observer.getCurrentResult().data,
          providerId: "codex",
          queryClient,
        })?.capabilities.supportsSessionRewind,
      ).toBe(true);
    });
    expect(sdk.providers.list).toHaveBeenCalledWith({
      environmentId: "env-remote",
      signal: expect.any(AbortSignal),
    });
    expect(sdk.system.executionOptions).not.toHaveBeenCalled();
  });
});

describe("useSystemProviders", () => {
  it("requests a usage-only provider roster", async () => {
    vi.mocked(sdk.providers.list).mockResolvedValue(PROVIDERS);
    const { queryClient } = createQueryClientTestHarness();

    observe(
      queryClient,
      systemProvidersQueryOptions({ capability: "usage", hostId: "host-a" }),
    );

    await vi.waitFor(() => {
      expect(sdk.providers.list).toHaveBeenCalledWith({
        capability: "usage",
        hostId: "host-a",
        signal: expect.any(AbortSignal),
      });
    });
  });

  it("replays only usage-capable providers for a usage query", async () => {
    const provider = (id: string, usage: boolean): ProviderInfo =>
      makeProviderInfo({
        id,
        displayName: id,
        logoUrl: null,
        maintenance: { health: true, usage, installation: false },
        capabilities: { permissionModes: ["full"] },
      });
    const usageProvider = provider("usage-provider", true);
    const unsupportedProvider = provider("unsupported-provider", false);
    vi.mocked(sdk.providers.list).mockResolvedValueOnce([
      usageProvider,
      unsupportedProvider,
    ]);
    const warm = observe(
      createQueryClientTestHarness().queryClient,
      systemProvidersQueryOptions({ hostId: "host-a" }),
    );
    await vi.waitFor(() => {
      expect(warm.getCurrentResult().data).toEqual([
        usageProvider,
        unsupportedProvider,
      ]);
    });
    stopObserving();

    vi.mocked(sdk.providers.list).mockImplementation(
      () => new Promise(() => undefined),
    );
    const result = observe(
      createQueryClientTestHarness().queryClient,
      systemProvidersQueryOptions({ capability: "usage", hostId: "host-a" }),
    ).getCurrentResult();

    expect(result.isPlaceholderData).toBe(true);
    expect(result.data).toEqual([usageProvider]);
  });
});

describe("useSystemExecutionOptions", () => {
  it("keeps dynamic providers visible while another provider's models load", async () => {
    const providers: ProviderInfo[] = [
      makeProviderInfo({
        id: "codex",
        displayName: "Codex",
        logoUrl: null,
        maintenance: { health: true, usage: true, installation: false },
        capabilities: {
          supportsServiceTier: true,
          supportsSessionRewind: true,
        },
      }),
      makeProviderInfo({
        id: "acp-opencode",
        displayName: "OpenCode",
        logoUrl: null,
        maintenance: { health: true, usage: true, installation: false },
        capabilities: {
          supportsThreadArchive: false,
          supportsThreadRename: false,
          supportsFork: false,
          permissionModes: ["full"],
        },
      }),
    ];
    let resolveDynamicModels: (
      response: SystemExecutionOptionsResponse,
    ) => void = () => {};
    const dynamicModels = new Promise<SystemExecutionOptionsResponse>(
      (resolve) => {
        resolveDynamicModels = resolve;
      },
    );
    vi.mocked(sdk.system.executionOptions).mockImplementation((args) =>
      args?.providerId === "acp-opencode"
        ? dynamicModels
        : Promise.resolve({ ...EXECUTION_OPTIONS_RESPONSE, providers }),
    );
    const { queryClient } = createQueryClientTestHarness();
    const observer = observe(
      queryClient,
      liveSystemExecutionOptionsQueryOptions({ providerId: "codex" }),
    );

    await vi.waitFor(() => {
      expect(observer.getCurrentResult().data?.providers).toEqual(providers);
      expect(observer.getCurrentResult().isPlaceholderData).toBe(false);
    });

    observer.setOptions(
      liveSystemExecutionOptionsQueryOptions({ providerId: "acp-opencode" }),
    );

    await vi.waitFor(() => {
      const result = observer.getCurrentResult();
      expect(result.isPlaceholderData).toBe(true);
      expect(result.data?.providers).toEqual(providers);
      expect(result.data?.models).toEqual([]);
    });

    resolveDynamicModels({ ...EXECUTION_OPTIONS_RESPONSE, providers });
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().isPlaceholderData).toBe(false);
    });
  });

  it("separates requests and cache entries for different hosts", async () => {
    vi.mocked(sdk.system.executionOptions).mockImplementation(async (args) =>
      args?.hostId === "host-a"
        ? { ...EXECUTION_OPTIONS_RESPONSE, models: [] }
        : { ...EXECUTION_OPTIONS_RESPONSE, selectedOnlyModels: [] },
    );
    const { queryClient } = createQueryClientTestHarness();

    observe(
      queryClient,
      liveSystemExecutionOptionsQueryOptions({
        hostId: "host-a",
        providerId: "codex",
      }),
    );
    observe(
      queryClient,
      liveSystemExecutionOptionsQueryOptions({
        hostId: "host-b",
        providerId: "codex",
      }),
    );

    await vi.waitFor(() => {
      expect(sdk.system.executionOptions).toHaveBeenCalledWith(
        expect.objectContaining({ hostId: "host-a", providerId: "codex" }),
      );
      expect(sdk.system.executionOptions).toHaveBeenCalledWith(
        expect.objectContaining({ hostId: "host-b", providerId: "codex" }),
      );
    });

    const hostAKey = systemExecutionOptionsQueryKey({
      environmentId: null,
      hostId: "host-a",
      providerId: "codex",
    });
    const hostBKey = systemExecutionOptionsQueryKey({
      environmentId: null,
      hostId: "host-b",
      providerId: "codex",
    });
    expect(hostAKey).not.toEqual(hostBKey);
    expect(queryClient.getQueryState(hostAKey)).toBeDefined();
    expect(queryClient.getQueryState(hostBKey)).toBeDefined();
    expect(systemProvidersQueryKey({ hostId: "host-a" })).not.toEqual(
      systemProvidersQueryKey({ hostId: "host-b" }),
    );
  });

  const BUILT_IN_PROVIDERS: ProviderInfo[] = ["codex", "pi"].map((id) =>
    makeProviderInfo({
      id,
      logoUrl: null,
      maintenance: { health: true, usage: true, installation: false },
      capabilities: {
        supportsThreadArchive: false,
        supportsThreadRename: false,
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
        supportsFork: true,
        supportsSessionRewind: true,
        modelCatalogScope: "workspace",
        permissionModes: ["accept-edits", "auto", "full"],
      },
    }),
  );
  const CODEX_MODEL: AvailableModel = {
    id: "gpt-5.6-sol",
    model: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    description: "",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: true,
  };
  const CODEX_CATALOG: SystemExecutionOptionsResponse = {
    ...EXECUTION_OPTIONS_RESPONSE,
    providers: BUILT_IN_PROVIDERS,
    models: [CODEX_MODEL],
  };
  const pendingForever = () => new Promise<never>(() => {});

  async function warmExecutionOptions(
    args: Parameters<typeof liveSystemExecutionOptionsQueryOptions>[0],
    loaded: (data: SystemExecutionOptionsResponse | undefined) => void,
  ): Promise<void> {
    const warm = observe(
      createQueryClientTestHarness().queryClient,
      liveSystemExecutionOptionsQueryOptions(args),
    );
    await vi.waitFor(() => loaded(warm.getCurrentResult().data));
    stopObserving();
  }

  function reloadExecutionOptions(
    args: Parameters<typeof liveSystemExecutionOptionsQueryOptions>[0],
    queryClient: QueryClient = createQueryClientTestHarness().queryClient,
  ) {
    return observe(
      queryClient,
      liveSystemExecutionOptionsQueryOptions(args),
    ).getCurrentResult();
  }

  it("preloads a provider's last verified catalog until the probe lands", async () => {
    vi.mocked(sdk.system.executionOptions).mockResolvedValue(CODEX_CATALOG);
    await warmExecutionOptions(
      { hostId: "host-a", providerId: "codex" },
      (data) => expect(data).toEqual(CODEX_CATALOG),
    );

    vi.mocked(sdk.system.executionOptions).mockImplementation(pendingForever);
    const result = reloadExecutionOptions({
      hostId: "host-a",
      providerId: "codex",
    });
    expect(result.isPlaceholderData).toBe(true);
    expect(result.data?.models).toEqual([CODEX_MODEL]);
    expect(result.data?.modelLoadError).toBeNull();
    expect(result.data?.permissionCeiling).toBe("accept-edits");
    await vi.waitFor(() =>
      expect(sdk.system.executionOptions).toHaveBeenCalledWith(
        expect.objectContaining({ hostId: "host-a", providerId: "codex" }),
      ),
    );
  });

  it("replays the host's provider list so a custom provider paints as itself", async () => {
    const customProvider = makeProviderInfo({
      id: "acp:my-agent",
      displayName: "My agent",
      logoUrl: null,
      maintenance: { health: true, usage: true, installation: false },
      capabilities: CODEX_CATALOG.providers[0]!.capabilities,
    });
    const customCatalog: SystemExecutionOptionsResponse = {
      ...CODEX_CATALOG,
      providers: [...CODEX_CATALOG.providers, customProvider],
    };
    vi.mocked(sdk.system.executionOptions).mockResolvedValue(customCatalog);
    await warmExecutionOptions(
      { hostId: "host-a", providerId: customProvider.id },
      (data) => expect(data).toEqual(customCatalog),
    );

    vi.mocked(sdk.system.executionOptions).mockImplementation(pendingForever);
    const result = reloadExecutionOptions({
      hostId: "host-a",
      providerId: customProvider.id,
    });
    expect(result.isPlaceholderData).toBe(true);
    expect(result.data?.providers).toEqual(customCatalog.providers);
    expect(result.data?.models).toEqual([CODEX_MODEL]);
  });

  it("withholds the placeholder when the remembered provider is not in any list it can replay", async () => {
    vi.mocked(sdk.system.executionOptions).mockResolvedValue({
      ...CODEX_CATALOG,
      providers: [],
    });
    await warmExecutionOptions(
      { hostId: "host-a", providerId: "acp:my-agent" },
      (data) => expect(data).toBeDefined(),
    );

    vi.mocked(sdk.system.executionOptions).mockImplementation(pendingForever);
    const result = reloadExecutionOptions({
      hostId: "host-a",
      providerId: "acp:my-agent",
    });
    expect(result.isPlaceholderData).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it("does not preload a catalog that came from a failed probe", async () => {
    vi.mocked(sdk.system.executionOptions).mockResolvedValue({
      ...CODEX_CATALOG,
      modelLoadError: { providerId: "codex", code: "failed", detail: null },
    });
    await warmExecutionOptions(
      { hostId: "host-a", providerId: "codex" },
      (data) => expect(data?.modelLoadError).not.toBeNull(),
    );

    vi.mocked(sdk.system.executionOptions).mockImplementation(pendingForever);
    const result = reloadExecutionOptions({
      hostId: "host-a",
      providerId: "codex",
    });
    expect(result.isPlaceholderData).toBe(true);
    expect(result.data?.models).toEqual([]);
  });

  it.each([
    ["failed", true, true, "codex", "codex"],
    ["failed", false, false, "codex", "codex"],
    ["timeout", true, true, "codex", "codex"],
    ["auth_required", false, true, "codex", "codex"],
    ["missing_executable", false, true, "codex", "codex"],
    ["provider_unavailable", false, true, "codex", "codex"],
    ["failed", true, true, undefined, "codex"],
    ["failed", false, true, undefined, "claude-code"],
  ] as const)(
    "handles reconnect refresh: %s (retain catalog: %s)",
    async (code, retainCatalog, hasCatalog, providerId, refreshProviderId) => {
      const { queryClient } = createQueryClientTestHarness();
      const initialCatalog = {
        ...CODEX_CATALOG,
        models: hasCatalog ? [CODEX_MODEL] : [],
      };
      vi.mocked(sdk.system.executionOptions).mockResolvedValue(initialCatalog);
      const observer = observe(
        queryClient,
        liveSystemExecutionOptionsQueryOptions({
          hostId: "host-a",
          providerId,
        }),
      );
      await vi.waitFor(() =>
        expect(observer.getCurrentResult().data).toEqual(initialCatalog),
      );
      const loadedAt = observer.getCurrentResult().dataUpdatedAt;
      const modelLoadError = {
        providerId: refreshProviderId,
        code,
        detail: null,
      };
      vi.mocked(sdk.system.executionOptions).mockResolvedValue({
        ...CODEX_CATALOG,
        providers: [makeProviderInfo({ id: refreshProviderId })],
        models: [],
        modelLoadError,
      });
      await queryClient.invalidateQueries({
        queryKey: systemExecutionOptionsQueryKey({
          environmentId: null,
          hostId: "host-a",
          providerId: providerId ?? null,
        }),
      });
      await vi.waitFor(() => {
        const result = observer.getCurrentResult();
        expect(sdk.system.executionOptions).toHaveBeenCalledTimes(2);
        expect(result.isFetching).toBe(false);
        expect(result.dataUpdatedAt).toBeGreaterThan(loadedAt);
        expect(result.data?.modelLoadError).toEqual(
          retainCatalog ? null : modelLoadError,
        );
      });
      expect(observer.getCurrentResult().data?.models).toEqual(
        retainCatalog ? [CODEX_MODEL] : [],
      );
      vi.mocked(sdk.system.executionOptions).mockResolvedValue(CODEX_CATALOG);
      await observer.refetch();
      await vi.waitFor(() =>
        expect(observer.getCurrentResult().data).toEqual(CODEX_CATALOG),
      );
    },
  );

  it("does not replay a catalog across environments", async () => {
    vi.mocked(sdk.system.executionOptions).mockResolvedValue(CODEX_CATALOG);
    await warmExecutionOptions(
      { environmentId: "env-1", providerId: "codex" },
      (data) => expect(data).toEqual(CODEX_CATALOG),
    );

    vi.mocked(sdk.system.executionOptions).mockImplementation(pendingForever);
    const { queryClient } = createQueryClientTestHarness();
    const unrouted = reloadExecutionOptions(
      { providerId: "codex" },
      queryClient,
    );
    const otherEnvironment = reloadExecutionOptions(
      { environmentId: "env-2", providerId: "codex" },
      queryClient,
    );
    const sameEnvironment = reloadExecutionOptions(
      { environmentId: "env-1", providerId: "codex" },
      queryClient,
    );
    expect(unrouted.isPlaceholderData).toBe(false);
    expect(unrouted.data).toBeUndefined();
    expect(otherEnvironment.isPlaceholderData).toBe(false);
    expect(otherEnvironment.data).toBeUndefined();
    expect(sameEnvironment.isPlaceholderData).toBe(true);
    expect(sameEnvironment.data?.models).toEqual([CODEX_MODEL]);
  });

  it("never preloads a catalog for another provider or another host", async () => {
    vi.mocked(sdk.system.executionOptions).mockResolvedValue(CODEX_CATALOG);
    await warmExecutionOptions(
      { hostId: "host-a", providerId: "codex" },
      (data) => expect(data).toEqual(CODEX_CATALOG),
    );

    vi.mocked(sdk.system.executionOptions).mockImplementation(pendingForever);
    const { queryClient } = createQueryClientTestHarness();
    const otherProvider = reloadExecutionOptions(
      { hostId: "host-a", providerId: "pi" },
      queryClient,
    );
    const otherHost = reloadExecutionOptions(
      { hostId: "host-b", providerId: "codex" },
      queryClient,
    );
    expect(otherProvider.isPlaceholderData).toBe(true);
    expect(otherProvider.data?.models).toEqual([]);
    expect(otherHost.isPlaceholderData).toBe(false);
    expect(otherHost.data).toBeUndefined();
  });

  it("prefetches sibling catalogs without touching remembered localStorage catalogs", async () => {
    vi.mocked(sdk.system.executionOptions).mockImplementation(async (args) => ({
      ...CODEX_CATALOG,
      models: [{ ...CODEX_MODEL, id: `${args?.providerId}-model` }],
    }));
    const { queryClient } = createQueryClientTestHarness();

    prefetchSystemExecutionOptions(queryClient, {
      routing: { hostId: "host-a" },
      providerIds: ["codex", "pi"],
    });

    await vi.waitFor(() => {
      for (const providerId of ["codex", "pi"]) {
        expect(
          queryClient.getQueryData<SystemExecutionOptionsResponse>(
            systemExecutionOptionsQueryKey({
              environmentId: null,
              hostId: "host-a",
              providerId,
            }),
          )?.models[0]?.id,
        ).toBe(`${providerId}-model`);
      }
    });
    expect(storage.length).toBe(0);
  });

  it("retries one transient failure before surfacing model selector errors", async () => {
    vi.mocked(sdk.system.executionOptions)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(EXECUTION_OPTIONS_RESPONSE);

    const observer = observe(
      createQueryClientTestHarness().queryClient,
      liveSystemExecutionOptionsQueryOptions({ providerId: "codex" }),
    );

    await vi.waitFor(() => {
      expect(observer.getCurrentResult().data).toBe(EXECUTION_OPTIONS_RESPONSE);
      expect(sdk.system.executionOptions).toHaveBeenCalledTimes(2);
    });
  });

  it("does not retry intentionally aborted model selector requests", async () => {
    vi.mocked(sdk.system.executionOptions).mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );

    const observer = observe(
      createQueryClientTestHarness().queryClient,
      liveSystemExecutionOptionsQueryOptions({ providerId: "codex" }),
    );

    await vi.waitFor(() => {
      expect(observer.getCurrentResult().isError).toBe(true);
      expect(sdk.system.executionOptions).toHaveBeenCalledTimes(1);
    });
  });
});

describe("useHostProviderCliStatus", () => {
  it("keeps host CLI status session-static", async () => {
    vi.mocked(sdk.hosts.providerCliStatus).mockResolvedValue(
      PROVIDER_CLI_STATUS_RESPONSE,
    );
    const { queryClient } = createQueryClientTestHarness();

    observe(
      queryClient,
      hostProviderCliStatusQueryOptions({ hostId: "host-1", enabled: true }),
    );

    await vi.waitFor(() => {
      expect(sdk.hosts.providerCliStatus).toHaveBeenCalledTimes(1);
    });

    const query = queryClient.getQueryCache().find({
      queryKey: hostProviderCliStatusQueryKey("host-1"),
    });

    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
      }),
    );
  });
});

describe("useSystemProviderStates", () => {
  it("separates provider-state results for different target machines", async () => {
    vi.mocked(sdk.system.providerStates).mockImplementation(async (args) =>
      providerStates(args?.hostId === "host-a" ? "codex" : "claude-code"),
    );
    const { queryClient } = createQueryClientTestHarness();

    const hostA = observe(
      queryClient,
      systemProviderStatesQueryOptions({ hostId: "host-a", poll: false }),
    );
    const hostB = observe(
      queryClient,
      systemProviderStatesQueryOptions({ hostId: "host-b", poll: false }),
    );

    await vi.waitFor(() => {
      expect(hostA.getCurrentResult().data?.providers[0]?.providerId).toBe(
        "codex",
      );
      expect(hostB.getCurrentResult().data?.providers[0]?.providerId).toBe(
        "claude-code",
      );
    });

    const hostAKey = systemProviderStatesQueryKey({
      environmentId: null,
      hostId: "host-a",
    });
    const hostBKey = systemProviderStatesQueryKey({
      environmentId: null,
      hostId: "host-b",
    });
    expect(hostAKey).not.toEqual(hostBKey);
    expect(queryClient.getQueryState(hostAKey)).toBeDefined();
    expect(queryClient.getQueryState(hostBKey)).toBeDefined();
  });

  it("routes reusable worktrees through their environment", async () => {
    vi.mocked(sdk.system.providerStates).mockResolvedValue(
      providerStates("claude-code"),
    );

    observe(
      createQueryClientTestHarness().queryClient,
      systemProviderStatesQueryOptions({
        environmentId: "env-remote",
        poll: false,
      }),
    );

    await vi.waitFor(() => {
      expect(sdk.system.providerStates).toHaveBeenCalledWith({
        environmentId: "env-remote",
        hostId: undefined,
        signal: expect.any(AbortSignal),
      });
    });
  });
});
