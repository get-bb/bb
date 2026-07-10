// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppTheme } from "@bb/domain";
import {
  FAVICON_COLOR_SERVER_SYNCED_STORAGE_KEY,
  FAVICON_COLOR_STORAGE_KEY,
  useFaviconColorSync,
} from "./favicon-color-preference";

const mocks = vi.hoisted(() => ({
  updateAppearance: vi.fn(),
  useSystemConfig: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.useSystemConfig,
}));

vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateAppearance: () => ({
    mutate: mocks.updateAppearance,
  }),
}));

function setSystemFaviconColor(
  faviconColor: typeof defaultAppTheme.faviconColor,
): void {
  mocks.useSystemConfig.mockReturnValue({
    data: {
      appearance: {
        ...defaultAppTheme,
        faviconColor,
      },
    },
  });
}

describe("favicon color server sync", () => {
  afterEach(() => {
    window.localStorage.clear();
    cleanup();
    vi.clearAllMocks();
  });

  it("migrates a cached legacy tint when the server has no stored tint yet", async () => {
    window.localStorage.setItem(FAVICON_COLOR_STORAGE_KEY, "teal");
    setSystemFaviconColor("default");
    mocks.updateAppearance.mockImplementation((_selection, options) => {
      options?.onSuccess?.();
    });

    renderHook(() => useFaviconColorSync());

    await waitFor(() =>
      expect(mocks.updateAppearance).toHaveBeenCalledWith(
        { themeId: "default", faviconColor: "teal" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      ),
    );
    expect(window.localStorage.getItem(FAVICON_COLOR_STORAGE_KEY)).toBe("teal");
    expect(
      window.localStorage.getItem(FAVICON_COLOR_SERVER_SYNCED_STORAGE_KEY),
    ).toBe("true");
  });

  it("does not restore a cached tint after the server value has been seen", async () => {
    window.localStorage.setItem(FAVICON_COLOR_STORAGE_KEY, "teal");
    setSystemFaviconColor("teal");
    const { rerender } = renderHook(() => useFaviconColorSync());

    await waitFor(() =>
      expect(
        window.localStorage.getItem(FAVICON_COLOR_SERVER_SYNCED_STORAGE_KEY),
      ).toBe("true"),
    );

    mocks.updateAppearance.mockClear();
    setSystemFaviconColor("default");
    rerender();

    await waitFor(() =>
      expect(window.localStorage.getItem(FAVICON_COLOR_STORAGE_KEY)).toBeNull(),
    );
    expect(mocks.updateAppearance).not.toHaveBeenCalled();
  });
});
