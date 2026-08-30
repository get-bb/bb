// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useSettingsNavState } from "./settings-nav";

const mocks = vi.hoisted(() => ({
  accessState: "unavailable",
  remoteUi: true,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
  useLocalHostDaemonAccess: () => ({ accessState: mocks.accessState }),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { experiments: { remoteUi: mocks.remoteUi } },
  }),
}));

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
  mocks.accessState = "unavailable";
  mocks.remoteUi = true;
});

describe("useSettingsNavState", () => {
  it("resolves the Providers bucket from its section route", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/providers"),
    });

    expect(result.current.activeSection).toBe("providers");
    expect(result.current.hasUnknownSection).toBe(false);
  });

  it("shows the Machines section", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/machines"),
    });

    expect(result.current.sections.map((section) => section.id)).toContain(
      "machines",
    );
  });

  it("shows Files when local helper access can be enabled", () => {
    mocks.accessState = "permission-required";
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/files"),
    });

    expect(result.current.sections.map((section) => section.id)).toContain(
      "files",
    );
  });

  it("resolves archived threads as a settings section", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/archived"),
    });

    expect(result.current.activeSection).toBe("archived");
    expect(result.current.sections.map((section) => section.id)).toContain(
      "archived",
    );
  });

  it("keeps plugin management out of Settings", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings"),
    });

    expect(result.current.sections.map((section) => section.id)).not.toContain(
      "plugins",
    );
  });

  it("hides Connection when the desktop server switcher is unavailable", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings"),
    });

    expect(result.current.sections.map((section) => section.id)).not.toContain(
      "connection",
    );
  });

  it("shows Connection when the desktop exposes the server switcher", () => {
    vi.stubGlobal("bbDesktop", {
      experimental_getServerTarget: () => Promise.resolve(null),
    });

    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/connection"),
    });

    expect(result.current.activeSection).toBe("connection");
    expect(result.current.sections.map((section) => section.id)).toContain(
      "connection",
    );
  });

  it("hides Connection when the remoteUi experiment is off", () => {
    mocks.remoteUi = false;
    vi.stubGlobal("bbDesktop", {
      experimental_getServerTarget: () => Promise.resolve(null),
    });

    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/connection"),
    });

    expect(result.current.sections.map((section) => section.id)).not.toContain(
      "connection",
    );
  });
});
