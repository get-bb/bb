// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { AppFileExternalNavigationHost } from "./AppFileExternalNavigationHost";

const openPreferred = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useResolvedLiveFileTarget", () => ({
  useResolvedLiveFileTarget: () => ({
    status: "available",
    absolutePath: "/workspace/src/example.ts",
    hostId: "host_1",
    openContext: { kind: "local" },
  }),
}));

vi.mock("@/hooks/useLocalOpenTargets", () => ({
  useLocalOpenTargets: () => ({
    isLoading: false,
    openPathInPreferredFileTarget: openPreferred,
  }),
}));

function Probe() {
  const navigation = useAppNavigationHost();
  return (
    <button
      type="button"
      onClick={() =>
        navigation.openFileExternally({
          target: {
            kind: "workspace",
            environmentId: "env_1",
            path: "src/example.ts",
          },
          location: { kind: "line", line: 12, column: 3 },
        })
      }
    >
      Open external
    </button>
  );
}

afterEach(() => {
  cleanup();
  openPreferred.mockReset();
  openPreferred.mockResolvedValue(true);
});

describe("AppFileExternalNavigationHost", () => {
  it("resolves and dispatches an accepted intent through the preferred target", async () => {
    render(
      <AppFileExternalNavigationHost>
        <Probe />
      </AppFileExternalNavigationHost>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open external" }));
    await waitFor(() =>
      expect(openPreferred).toHaveBeenCalledWith({
        columnNumber: 3,
        lineNumber: 12,
        path: "/workspace/src/example.ts",
      }),
    );
  });
});
