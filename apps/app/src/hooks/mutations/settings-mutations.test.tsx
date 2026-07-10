// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SystemConfigResponse } from "@bb/server-contract";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
  type AppKeybindingOverrides,
  type AppKeybindings,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { systemConfigQueryKey } from "../queries/query-keys";
import { useUpdateKeyboardSettings } from "./settings-mutations";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    updateKeyboardSettings: vi.fn(),
  };
});

const defaultKeybindings: AppKeybindings = [
  {
    command: "thread.new",
    desktopOnly: true,
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
  return {
    generalSettings: defaultAppSettings,
    keybindings: defaultKeybindings,
    defaultKeybindings,
    keybindingOverrides: [],
    experiments: defaultExperiments,
    appearance: defaultAppTheme,
    customThemes: [],
    featureFlags: { placeholder: false },
    hostDaemonPort: null,
    primaryHostPlatform: null,
    voiceTranscriptionEnabled: false,
    dataDir: "/tmp/bb-test",
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("keyboard settings mutation", () => {
  it("updates resolved system config before the request completes", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(systemConfigQueryKey(), systemConfig());
    let resolveRequest: (overrides: AppKeybindingOverrides) => void = () => {};
    vi.mocked(api.updateKeyboardSettings).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
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
    const { result } = renderHook(() => useUpdateKeyboardSettings(), {
      wrapper,
    });

    act(() => result.current.mutate(overrides));
    await waitFor(() => {
      expect(
        queryClient.getQueryData<SystemConfigResponse>(systemConfigQueryKey())
          ?.keybindings[0]?.shortcut,
      ).toMatchObject({ key: "u", shift: true });
    });

    act(() => resolveRequest(overrides));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("restores resolved system config when the request fails", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(systemConfigQueryKey(), systemConfig());
    vi.mocked(api.updateKeyboardSettings).mockRejectedValue(
      new Error("write failed"),
    );
    const { result } = renderHook(() => useUpdateKeyboardSettings(), {
      wrapper,
    });

    act(() =>
      result.current.mutate([{ command: "thread.new", shortcut: null }]),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    const restored = queryClient.getQueryData<SystemConfigResponse>(
      systemConfigQueryKey(),
    );
    expect(restored?.keybindingOverrides).toEqual([]);
    expect(restored?.keybindings).toEqual(defaultKeybindings);
  });
});
