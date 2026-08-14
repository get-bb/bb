// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalOpenTargetSettingsSection } from "./SettingsView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSection({
  accessState,
  hasDaemon = false,
  onRequestAccess = vi.fn(async () => true),
}: {
  accessState:
    | "available"
    | "denied"
    | "permission-required"
    | "unavailable"
    | "unsupported";
  hasDaemon?: boolean;
  onRequestAccess?: () => Promise<boolean>;
}) {
  render(
    <LocalOpenTargetSettingsSection
      accessState={accessState}
      directoryTargetId={null}
      fileTargetId={null}
      hasDaemon={hasDaemon}
      onDirectoryTargetChange={vi.fn()}
      onFileTargetChange={vi.fn()}
      onRequestAccess={onRequestAccess}
      targets={[]}
    />,
  );
  return { onRequestAccess };
}

describe("LocalOpenTargetSettingsSection", () => {
  it("requests local helper access only after the user clicks Enable", async () => {
    const { onRequestAccess } = renderSection({
      accessState: "permission-required",
    });

    expect(onRequestAccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(onRequestAccess).toHaveBeenCalledTimes(1));
  });

  it("explains denied access without retrying it", () => {
    const { onRequestAccess } = renderSection({ accessState: "denied" });

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Blocked" })
        .disabled,
    ).toBe(true);
    expect(screen.queryByText(/allow local network access/i)).not.toBeNull();
    expect(onRequestAccess).not.toHaveBeenCalled();
  });

  it("retries after the helper was unavailable", async () => {
    const { onRequestAccess } = renderSection({ accessState: "available" });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onRequestAccess).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText(/couldn’t connect to its local editor helper/i),
    ).not.toBeNull();
  });

  it("opens the remote-browser setup guide", () => {
    const openWindow = vi.spyOn(window, "open").mockImplementation(() => null);
    renderSection({ accessState: "available" });

    fireEvent.click(screen.getByRole("link", { name: "Setup guide" }));

    expect(openWindow).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/get-bb/bb/blob/main/docs/multiple-devices.md#open-bb-from-another-browser",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("shows editor preferences when the helper is reachable", () => {
    renderSection({ accessState: "available", hasDaemon: true });

    expect(screen.queryByText("Directory default")).not.toBeNull();
    expect(screen.queryByText("File default")).not.toBeNull();
    expect(screen.queryByText("Local editor integration")).toBeNull();
  });
});
