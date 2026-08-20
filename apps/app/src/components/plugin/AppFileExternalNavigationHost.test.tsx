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
const recordAccepted = vi.fn();

vi.mock("@/hooks/useResolvedLiveFileTarget", () => ({
  useResolvedLiveFileTarget: (target: { path: string }) => ({
    status: "available",
    absolutePath: `/workspace/${target.path}`,
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
    <>
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
      <button
        type="button"
        onClick={() => {
          const firstAccepted = navigation.openFileExternally({
            target: {
              kind: "workspace",
              environmentId: "env_1",
              path: "src/first.ts",
            },
            location: { kind: "line", line: 10, column: 2 },
          });
          const secondAccepted = navigation.openFileExternally({
            target: {
              kind: "workspace",
              environmentId: "env_1",
              path: "src/second.ts",
            },
            location: { kind: "line", line: 20, column: 4 },
          });
          recordAccepted(firstAccepted, secondAccepted);
        }}
      >
        Open two external
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  openPreferred.mockReset();
  openPreferred.mockResolvedValue(true);
  recordAccepted.mockReset();
});

describe("AppFileExternalNavigationHost", () => {
  it("resolves and dispatches an accepted intent through the preferred target", async () => {
    render(
      <AppFileExternalNavigationHost>
        <Probe />
      </AppFileExternalNavigationHost>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open external" }));
    await waitFor(
      () =>
        expect(openPreferred).toHaveBeenCalledWith({
          columnNumber: 3,
          lineNumber: 12,
          path: "/workspace/src/example.ts",
        }),
      { timeout: 5_000 },
    );
  });

  it("dispatches queued intents once each in FIFO order", async () => {
    render(
      <AppFileExternalNavigationHost>
        <Probe />
      </AppFileExternalNavigationHost>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open two external" }));

    expect(recordAccepted).toHaveBeenCalledWith(true, true);
    await waitFor(() => expect(openPreferred).toHaveBeenCalledTimes(2), {
      timeout: 5_000,
    });
    expect(openPreferred).toHaveBeenNthCalledWith(1, {
      columnNumber: 2,
      lineNumber: 10,
      path: "/workspace/src/first.ts",
    });
    expect(openPreferred).toHaveBeenNthCalledWith(2, {
      columnNumber: 4,
      lineNumber: 20,
      path: "/workspace/src/second.ts",
    });
  });
});
