// @vitest-environment jsdom

import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { SystemConfigResponse } from "@bb/server-contract";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PluginNavIcon, useSettingsNavState } from "./settings-nav";

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { config: vi.fn() } },
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
}));

function systemConfig(pluginsEnabled: boolean): SystemConfigResponse {
  return {
    generalSettings: defaultAppSettings,
    keybindings: [],
    defaultKeybindings: [],
    keybindingOverrides: [],
    experiments: {
      ...defaultExperiments,
      plugins: pluginsEnabled,
    },
    appearance: defaultAppTheme,
    customThemes: [],
    pluginThemes: [],
    featureFlags: { placeholder: false },
    hostDaemonPort: null,
    primaryHostId: null,
    primaryHostPlatform: null,
    voiceTranscriptionEnabled: false,
    dataDir: "/tmp/bb-test",
  };
}

function Component() {
  return null;
}

function wrapperFor(path: string) {
  const { wrapper: QueryWrapper } = createQueryClientTestHarness();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryWrapper>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </QueryWrapper>
    );
  };
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useSettingsNavState", () => {
  it("resolves Codex and Claude Code as separate provider pages", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig(false));

    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/providers/claude-code"),
    });

    await waitFor(() => {
      expect(result.current.activeProviderId).toBe("claude-code");
    });
    expect(result.current.activeSection).toBeNull();
    expect(
      result.current.providerEntries.map((provider) => provider.id),
    ).toEqual(["codex", "claude-code"]);
  });

  it("shows the Machines section", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig(false));

    const result = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/machines"),
    });
    await waitFor(() => {
      expect(
        result.result.current.sections.map((section) => section.id),
      ).toContain("machines");
    });
  });

  it("resolves archived threads as a settings section", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig(false));

    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/archived"),
    });

    await waitFor(() => {
      expect(result.current.activeSection).toBe("archived");
    });
    expect(result.current.sections.map((section) => section.id)).toContain(
      "archived",
    );
  });

  it("shows slot-backed plugin settings entries while the plugins experiment is off", async () => {
    vi.mocked(sdk.system.config).mockResolvedValue(systemConfig(false));
    setPluginSlotRegistrations("connect", {
      homepageSections: [],
      settingsSections: [{ id: "remote", component: Component }],
      navPanels: [],
      threadPanelActions: [],
      composerAccessories: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          enabled: false,
          plugins: [
            {
              id: "connect",
              source: "builtin:connect",
              rootDir: "/tmp/bb-test/plugins/connect",
              version: "0.1.0",
              provenance: "builtin",
              isOrphanedBuiltin: false,
              sourceDisplay: "builtin",
              updateState: {},
              enabled: true,
              description: null,
              name: "Connect",
              icon: "EditFile",
              status: "running",
              statusDetail: null,
              handlerStats: {
                count: 0,
                totalMs: 0,
                maxMs: 0,
                errorCount: 0,
              },
              services: [],
              schedules: [],
              cliCommand: null,
              hasSettings: false,
              app: { hasApp: true, bundle: null },
              logoUrl: null,
              logoDarkUrl: null,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/plugins/connect"),
    });

    await waitFor(() => {
      expect(result.current.pluginEntries.map((plugin) => plugin.id)).toEqual([
        "connect",
      ]);
    });
    expect(result.current.sections.map((section) => section.id)).not.toContain(
      "plugins",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );

    const icon = render(
      <PluginNavIcon plugin={result.current.pluginEntries[0]!} />,
    );
    expect(
      icon.container.querySelector('[data-icon="EditFile"]'),
    ).not.toBeNull();
  });
});
