// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneralSettingsSection } from "./SettingsView";

afterEach(cleanup);

function renderSection(overrides?: {
  idleProviderSessionTimeoutMinutes?: number | null;
  onIdleProviderSessionTimeoutMinutesChange?: (minutes: number | null) => void;
  terminalCopyOnSelect?: boolean;
  onTerminalCopyOnSelectChange?: (enabled: boolean) => void;
  generalSettingsDisabled?: boolean;
  managedBranchPrefix?: string;
  onManagedBranchPrefixChange?: (prefix: string) => void;
}) {
  return render(
    <GeneralSettingsSection
      idleProviderSessionTimeoutMinutes={
        overrides?.idleProviderSessionTimeoutMinutes === undefined
          ? 30
          : overrides.idleProviderSessionTimeoutMinutes
      }
      onIdleProviderSessionTimeoutMinutesChange={
        overrides?.onIdleProviderSessionTimeoutMinutesChange ?? vi.fn()
      }
      showGitChanges={true}
      onShowGitChangesChange={vi.fn()}
      confirmThreadArchive={true}
      onConfirmThreadArchiveChange={vi.fn()}
      keepHistoryAfterContextClear={false}
      onKeepHistoryAfterContextClearChange={vi.fn()}
      summarizeShellCommands={true}
      onSummarizeShellCommandsChange={vi.fn()}
      desktopBrowserAvailable={false}
      generalSettingsDisabled={overrides?.generalSettingsDisabled ?? false}
      terminalCopyOnSelect={overrides?.terminalCopyOnSelect ?? true}
      onTerminalCopyOnSelectChange={
        overrides?.onTerminalCopyOnSelectChange ?? vi.fn()
      }
      managedBranchPrefix={overrides?.managedBranchPrefix ?? "bb/"}
      navigateToThreadAfterCreate={false}
      onManagedBranchPrefixChange={
        overrides?.onManagedBranchPrefixChange ?? vi.fn()
      }
      onNavigateToThreadAfterCreateChange={vi.fn()}
      onOpenLinksInAppBrowserChange={vi.fn()}
      onReplaySetupGuide={vi.fn()}
      onRewriteLocalhostLinksChange={vi.fn()}
      onSteerActiveThreadOnEnterChange={vi.fn()}
      openLinksInAppBrowser={false}
      rewriteLocalhostLinks={false}
      steerActiveThreadOnEnter={false}
    />,
  );
}

function branchPrefixInput() {
  const input = screen.getByLabelText("New branch prefix");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("New branch prefix control is not an input");
  }
  return input;
}

describe("idle agent session setting", () => {
  it.each([0, 5, null])("saves %s from the menu", async (minutes) => {
    const onChange = vi.fn();
    renderSection({ onIdleProviderSessionTimeoutMinutesChange: onChange });
    const trigger = screen.getByRole("button", {
      name: "Release idle agent sessions",
    });
    expect(trigger.textContent).toContain("30 minutes");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const label =
      minutes === null
        ? "Never"
        : minutes === 0
          ? "Next cleanup"
          : `${minutes} minutes`;
    fireEvent.click(await screen.findByRole("menuitem", { name: label }));
    expect(onChange).toHaveBeenCalledWith(minutes);
    cleanup();
    renderSection({ idleProviderSessionTimeoutMinutes: minutes });
    expect(
      screen.getByRole("button", { name: "Release idle agent sessions" })
        .textContent,
    ).toContain(label);
  });

  it("displays custom CLI values and disables changes while loading", () => {
    renderSection({
      idleProviderSessionTimeoutMinutes: 17,
      generalSettingsDisabled: true,
    });
    const trigger = screen.getByRole("button", {
      name: "Release idle agent sessions",
    });
    expect(trigger.textContent).toContain("17 minutes");
    expect(trigger.hasAttribute("disabled")).toBe(true);
  });
});

describe("terminal copy-on-select setting", () => {
  it("displays the saved value and allows opting out", () => {
    const onChange = vi.fn();
    renderSection({ onTerminalCopyOnSelectChange: onChange });
    const toggle = screen.getByRole("switch", { name: "Copy on select" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
    cleanup();
    renderSection({ terminalCopyOnSelect: false });
    expect(
      screen
        .getByRole("switch", { name: "Copy on select" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("prevents changes while settings are loading or saving", () => {
    const onChange = vi.fn();
    renderSection({
      generalSettingsDisabled: true,
      onTerminalCopyOnSelectChange: onChange,
    });
    fireEvent.click(screen.getByRole("switch", { name: "Copy on select" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("new branch prefix setting", () => {
  it("saves a valid prefix on Enter", () => {
    const onChange = vi.fn();
    renderSection({ onManagedBranchPrefixChange: onChange });
    const input = branchPrefixInput();
    fireEvent.change(input, { target: { value: "sawyer/wt-" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("sawyer/wt-");
  });

  it("saves an empty prefix", () => {
    const onChange = vi.fn();
    renderSection({ onManagedBranchPrefixChange: onChange });
    const input = branchPrefixInput();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("restores the saved value when saving fails", async () => {
    const failedSave = Promise.reject(new Error("write failed"));
    void failedSave.catch(() => undefined);
    const onChange = vi.fn(() => failedSave);
    renderSection({ onManagedBranchPrefixChange: onChange });
    const input = branchPrefixInput();
    fireEvent.change(input, { target: { value: "team/" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input.value).toBe("bb/"));
  });

  it("refuses an invalid prefix and restores the saved value", () => {
    const onChange = vi.fn();
    renderSection({ onManagedBranchPrefixChange: onChange });
    const input = branchPrefixInput();
    fireEvent.change(input, { target: { value: "bad prefix/" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("bb/");
  });

  it("reverts the draft on Escape", () => {
    const onChange = vi.fn();
    renderSection({ onManagedBranchPrefixChange: onChange });
    const input = branchPrefixInput();
    fireEvent.change(input, { target: { value: "sawyer/" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("bb/");
    expect(onChange).not.toHaveBeenCalled();
  });
});
