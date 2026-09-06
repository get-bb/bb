// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultResolvedCodeTheme, type AppTheme } from "@bb/domain";
import { applyAppThemeCss, clearAppThemePreview } from "@/lib/themes";
import { useAppThemePreview } from "./useAppThemePreview";

const resolveMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", () => ({
  sdk: { theme: { resolve: resolveMock } },
}));

const COMMITTED = ":root { --canvas: white; }";

function customTheme(themeId: string, customCss: string): AppTheme {
  return {
    themeId,
    customCss,
    faviconColor: "default",
    resolvedCodeTheme: defaultResolvedCodeTheme,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function styleText(): string | null {
  return document.getElementById("bb-app-theme")?.textContent ?? null;
}

function renderPreviewHook() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useAppThemePreview(), { wrapper });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  cleanup();
  clearAppThemePreview();
  applyAppThemeCss("");
  resolveMock.mockReset();
});

describe("useAppThemePreview", () => {
  it("previews a resolved theme and restores the committed one on clear", async () => {
    applyAppThemeCss(COMMITTED);
    resolveMock.mockResolvedValue(customTheme("mine", ".mine {}"));
    const { result } = renderPreviewHook();

    act(() => result.current.previewTheme("mine"));
    await flush();
    expect(styleText()).toBe(".mine {}");
    expect(resolveMock).toHaveBeenCalledWith(
      expect.objectContaining({ themeId: "mine" }),
    );

    act(() => result.current.previewTheme(null));
    expect(styleText()).toBe(COMMITTED);
  });

  it("ignores a resolution that lands after the pointer left", async () => {
    applyAppThemeCss(COMMITTED);
    const slow = deferred<AppTheme>();
    resolveMock.mockReturnValue(slow.promise);
    const { result } = renderPreviewHook();

    act(() => result.current.previewTheme("slow"));
    act(() => result.current.previewTheme(null));
    slow.resolve(customTheme("slow", ".slow {}"));
    await flush();

    expect(styleText()).toBe(COMMITTED);
  });

  it("keeps the latest hovered theme when an earlier fetch resolves late", async () => {
    applyAppThemeCss(COMMITTED);
    const first = deferred<AppTheme>();
    const second = deferred<AppTheme>();
    resolveMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderPreviewHook();

    act(() => result.current.previewTheme("first"));
    act(() => result.current.previewTheme("second"));
    second.resolve(customTheme("second", ".second {}"));
    await flush();
    first.resolve(customTheme("first", ".first {}"));
    await flush();

    expect(styleText()).toBe(".second {}");
  });

  it("serves repeat hovers from the query cache and retries after a failure", async () => {
    applyAppThemeCss(COMMITTED);
    resolveMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(customTheme("mine", ".mine {}"));
    const { result } = renderPreviewHook();

    act(() => result.current.previewTheme("mine"));
    await flush();
    expect(styleText()).toBe(COMMITTED);

    act(() => result.current.previewTheme("mine"));
    await flush();
    expect(styleText()).toBe(".mine {}");

    act(() => result.current.previewTheme(null));
    act(() => result.current.previewTheme("mine"));
    await flush();
    expect(resolveMock).toHaveBeenCalledTimes(2);
    expect(styleText()).toBe(".mine {}");
  });

  it("prefetches palettes so the first hover applies from the query cache", async () => {
    applyAppThemeCss(COMMITTED);
    resolveMock.mockImplementation(({ themeId }: { themeId: string }) =>
      Promise.resolve(customTheme(themeId, `.${themeId} {}`)),
    );
    const { result } = renderPreviewHook();

    act(() => result.current.prefetchThemes(["one", "two"]));
    await flush();
    expect(resolveMock).toHaveBeenCalledTimes(2);

    act(() => result.current.previewTheme("two"));
    await flush();
    expect(styleText()).toBe(".two {}");
    expect(resolveMock).toHaveBeenCalledTimes(2);
  });

  it("clears the preview when the owner unmounts", async () => {
    applyAppThemeCss(COMMITTED);
    resolveMock.mockResolvedValue(customTheme("mine", ".mine {}"));
    const { result, unmount } = renderPreviewHook();

    act(() => result.current.previewTheme("mine"));
    await flush();
    expect(styleText()).toBe(".mine {}");

    unmount();
    expect(styleText()).toBe(COMMITTED);
  });
});
