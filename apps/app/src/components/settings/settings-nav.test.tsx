// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { SystemConfigResponse } from "@bb/server-contract";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useSettingsNavState } from "./settings-nav";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getSystemConfig: vi.fn(),
  };
});

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
}));

function systemConfig(pluginsEnabled: boolean): SystemConfigResponse {
  return {
    generalSettings: defaultAppSettings,
    experiments: { ...defaultExperiments, plugins: pluginsEnabled },
    appearance: defaultAppTheme,
    customThemes: [],
    featureFlags: { placeholder: false },
    hostDaemonPort: null,
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
  it("shows slot-backed plugin settings entries while the plugins experiment is off", async () => {
    vi.mocked(api.getSystemConfig).mockResolvedValue(systemConfig(false));
    setPluginSlotRegistrations("connect", {
      homepageSections: [],
      settingsSections: [{ id: "remote", component: Component }],
      navPanels: [],
      threadPanelActions: [],
      composerAccessories: [],
      fileOpeners: [],
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          plugins: [
            {
              id: "connect",
              version: "0.1.0",
              enabled: true,
              status: "running",
              statusDetail: null,
              description: null,
              logoUrl: null,
              logoDarkUrl: null,
              hasSettings: false,
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
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/plugins");
  });
});
