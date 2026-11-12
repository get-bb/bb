// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  makeThread,
  makeEnvironment,
  makeHost,
} from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@bb/shared-ui/dialog";
import { ThreadDirectoryDialogContent } from "./ThreadDirectoryDialog";

const mocks = vi.hoisted(() => ({
  change: vi.fn(),
  hosts: [] as { id: string; name: string; status: string }[],
  toast: vi.fn(),
}));
vi.mock("@/lib/plugin-bound-sdk", () => ({
  getPluginBoundSdk: () => ({
    threads: { experimental_changeDirectory: mocks.change },
  }),
}));
vi.mock("@/lib/sdk", () => ({ sdk: {} }));
vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: mocks.hosts }),
}));
vi.mock("@/lib/mutation-errors", () => ({
  showMutationErrorToast: mocks.toast,
}));
vi.mock("@/components/dialogs/LazyRemotePathBrowser", () => ({
  LazyRemotePathBrowser: ({
    hostId,
    disabled,
    onDirectoryChange,
  }: {
    hostId: string;
    disabled: boolean;
    onDirectoryChange: (path: string) => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onDirectoryChange("/remote/new-repo/")}
    >
      Choose on {hostId}
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(connected = true) {
  mocks.hosts = [
    makeHost({
      id: "host_remote",
      name: "Remote Mac",
      status: connected ? "connected" : "disconnected",
    }),
  ];
  const close = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Dialog open>
        <ThreadDirectoryDialogContent
          thread={makeThread({ id: "thr_directory" })}
          environment={makeEnvironment({
            id: "env_directory",
            hostId: "host_remote",
            path: "/remote/old",
          })}
          onClose={close}
        />
      </Dialog>
    </QueryClientProvider>,
  );
  return { close };
}

describe("thread directory picker", () => {
  it("uses the thread host and closes only after the server confirms the change", async () => {
    let finish: (() => void) | undefined;
    mocks.change.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { close } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose on host_remote" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Change directory" }));
    await waitFor(() =>
      expect(mocks.change).toHaveBeenCalledWith({
        threadId: "thr_directory",
        path: "/remote/new-repo",
        expectedEnvironmentId: "env_directory",
      }),
    );
    expect(close).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("button", { name: "Changing…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    finish?.();
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it("keeps the folder picker open on a server refusal", async () => {
    mocks.change.mockRejectedValue(new Error("Thread became active"));
    const { close } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose on host_remote" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Change directory" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
    expect(close).not.toHaveBeenCalled();
  });

  it("disables submission when the thread host is offline", () => {
    setup(false);
    expect(screen.getByText(/machine is offline/u)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Change directory" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(mocks.change).not.toHaveBeenCalled();
  });
});
