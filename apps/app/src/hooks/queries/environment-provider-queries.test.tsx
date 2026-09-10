// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useSystemEnvironmentProviders } from "./environment-provider-queries";
import {
  environmentProviderListCacheKey,
  readCachedEnvironmentProviderList,
  writeCachedEnvironmentProviderList,
} from "@/lib/environment-provider-list-cache";

vi.mock("@/lib/sdk", () => ({
  sdk: { environments: { listProviders: vi.fn() } },
}));

const WORKTREE_PROVIDER: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "git-worktree",
  displayName: "Worktree",
  icon: "GitBranch",
  logoUrl: null,
  pluginId: "environment-git-worktree",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: true,
    gitCheckout: true,
    gitRemote: false,
    projectless: false,
  },
  inputs: null,
};

function pendingForever(): Promise<never> {
  return new Promise(() => {});
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("useSystemEnvironmentProviders", () => {
  it("loads eligibility for the requested project and machine", async () => {
    vi.mocked(sdk.environments.listProviders).mockResolvedValue([
      WORKTREE_PROVIDER,
    ]);
    const { result } = renderHook(
      () =>
        useSystemEnvironmentProviders({
          projectId: "project-1",
          hostId: "host-1",
        }),
      {
        wrapper: createQueryClientTestHarness().wrapper,
      },
    );

    await waitFor(() =>
      expect(result.current.providers).toEqual([WORKTREE_PROVIDER]),
    );
    expect(sdk.environments.listProviders).toHaveBeenCalledWith({
      projectId: "project-1",
      hostId: "host-1",
    });
  });

  it("remembers a project's list and serves it before the server answers", async () => {
    vi.mocked(sdk.environments.listProviders).mockResolvedValue([
      WORKTREE_PROVIDER,
    ]);
    const first = renderHook(
      () => useSystemEnvironmentProviders({ projectId: "project-1" }),
      { wrapper: createQueryClientTestHarness().wrapper },
    );
    expect(first.result.current.providers).toBeUndefined();
    await waitFor(() =>
      expect(first.result.current.providers).toEqual([WORKTREE_PROVIDER]),
    );
    const cacheKey = environmentProviderListCacheKey({
      projectId: "project-1",
      hostId: null,
    });
    expect(readCachedEnvironmentProviderList(cacheKey)).toEqual([
      WORKTREE_PROVIDER,
    ]);

    vi.mocked(sdk.environments.listProviders).mockImplementation(
      pendingForever,
    );
    const second = renderHook(
      () => useSystemEnvironmentProviders({ projectId: "project-1" }),
      { wrapper: createQueryClientTestHarness().wrapper },
    );
    expect(second.result.current.providers).toEqual([WORKTREE_PROVIDER]);
  });

  it("ignores a remembered list that no longer parses", () => {
    vi.mocked(sdk.environments.listProviders).mockImplementation(
      pendingForever,
    );
    const cacheKey = environmentProviderListCacheKey({
      projectId: "project-1",
      hostId: null,
    });
    writeCachedEnvironmentProviderList(cacheKey, [WORKTREE_PROVIDER]);
    window.localStorage.setItem(cacheKey, JSON.stringify([{ id: 1 }]));
    const { result } = renderHook(
      () => useSystemEnvironmentProviders({ projectId: "project-1" }),
      { wrapper: createQueryClientTestHarness().wrapper },
    );
    expect(result.current.providers).toBeUndefined();
  });

  it("reports the list as unresolved when nothing was remembered", () => {
    vi.mocked(sdk.environments.listProviders).mockImplementation(
      pendingForever,
    );
    const { result } = renderHook(() => useSystemEnvironmentProviders(), {
      wrapper: createQueryClientTestHarness().wrapper,
    });

    expect(result.current.providers).toBeUndefined();
  });
});
