import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginSafeModeQueryKey } from "@/hooks/queries/query-keys";
import { changePluginSafeMode } from "./usePluginSafeModeCommands";

const setPluginSafeMode = vi.hoisted(() =>
  vi.fn((_fetch: unknown, enabled: boolean) =>
    Promise.resolve({ enabled, problems: [] as string[] }),
  ),
);
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/hooks/queries/plugin-settings-queries", () => ({
  setPluginSafeMode,
}));

vi.mock("@/components/ui/app-toast", () => ({ appToast: toast }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("changePluginSafeMode", () => {
  it("turns safe mode on and records the server's answer", async () => {
    const queryClient = new QueryClient();

    await changePluginSafeMode({ enabled: true, queryClient });

    expect(toast.success).toHaveBeenCalledWith(
      "Plugin safe mode is on",
      expect.anything(),
    );
    expect(setPluginSafeMode).toHaveBeenCalledWith(expect.anything(), true);
    expect(queryClient.getQueryData(pluginSafeModeQueryKey())).toBe(true);
  });

  it("warns with the plugins that did not start when safe mode ends", async () => {
    setPluginSafeMode.mockResolvedValueOnce({
      enabled: false,
      problems: ['plugin "alpha" did not start: boom'],
    });

    await changePluginSafeMode({
      enabled: false,
      queryClient: new QueryClient(),
    });

    expect(toast.warning).toHaveBeenCalledWith("Some plugins did not start", {
      description: 'plugin "alpha" did not start: boom',
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("turns safe mode off and reports a failure", async () => {
    setPluginSafeMode.mockRejectedValueOnce(new Error("server unavailable"));

    await changePluginSafeMode({
      enabled: false,
      queryClient: new QueryClient(),
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Failed to turn off plugin safe mode",
      { description: "server unavailable" },
    );
    expect(setPluginSafeMode).toHaveBeenCalledWith(expect.anything(), false);
  });
});
