// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { appToast } from "@/components/ui/app-toast";
import { copyToClipboardWithToast } from "./clipboard";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const appToastMock = vi.mocked(appToast);
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "execCommand",
);

function restoreProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, property);
    return;
  }
  Object.defineProperty(target, property, descriptor);
}

function setNavigatorClipboard(writeText: Clipboard["writeText"] | null): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText === null ? undefined : { writeText },
  });
}

function setExecCommand(execCommand: Document["execCommand"]): void {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  restoreProperty(navigator, "clipboard", originalClipboardDescriptor);
  restoreProperty(document, "execCommand", originalExecCommandDescriptor);
  document.body.replaceChildren();
});

describe("copyToClipboardWithToast", () => {
  it("uses navigator clipboard when available", async () => {
    const writeText = vi.fn<Clipboard["writeText"]>(async () => {});
    const execCommand = vi.fn<Document["execCommand"]>(() => true);
    setNavigatorClipboard(writeText);
    setExecCommand(execCommand);

    await expect(
      copyToClipboardWithToast("feature/clipboard", {
        successMessage: "Copied branch name",
        errorMessage: "Failed to copy branch name",
      }),
    ).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("feature/clipboard");
    expect(execCommand).not.toHaveBeenCalled();
    expect(appToastMock.success).toHaveBeenCalledWith("Copied branch name");
    expect(appToastMock.error).not.toHaveBeenCalled();
  });

  it("falls back to selection copy when navigator clipboard is unavailable", async () => {
    let selectedText: string | null = null;
    const execCommand = vi.fn<Document["execCommand"]>((command) => {
      const activeElement = document.activeElement;
      selectedText =
        activeElement instanceof HTMLTextAreaElement && command === "copy"
          ? activeElement.value.slice(
              activeElement.selectionStart,
              activeElement.selectionEnd,
            )
          : null;
      return true;
    });
    setNavigatorClipboard(null);
    setExecCommand(execCommand);

    await expect(
      copyToClipboardWithToast("feature/web-copy", {
        successMessage: "Copied branch name",
        errorMessage: "Failed to copy branch name",
      }),
    ).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(selectedText).toBe("feature/web-copy");
    expect(document.querySelector("textarea")).toBeNull();
    expect(appToastMock.success).toHaveBeenCalledWith("Copied branch name");
    expect(appToastMock.error).not.toHaveBeenCalled();
  });

  it("falls back to selection copy when navigator clipboard rejects", async () => {
    const writeText = vi.fn<Clipboard["writeText"]>(async () => {
      throw new Error("denied");
    });
    const execCommand = vi.fn<Document["execCommand"]>(() => true);
    setNavigatorClipboard(writeText);
    setExecCommand(execCommand);

    await expect(
      copyToClipboardWithToast("feature/retry-copy", {
        errorMessage: "Failed to copy branch name",
      }),
    ).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("feature/retry-copy");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(appToastMock.error).not.toHaveBeenCalled();
  });

  it("shows the error toast when every copy path fails", async () => {
    const execCommand = vi.fn<Document["execCommand"]>(() => false);
    setNavigatorClipboard(null);
    setExecCommand(execCommand);

    await expect(
      copyToClipboardWithToast("feature/no-copy", {
        errorMessage: "Failed to copy branch name",
      }),
    ).resolves.toBe(false);

    expect(appToastMock.success).not.toHaveBeenCalled();
    expect(appToastMock.error).toHaveBeenCalledWith(
      "Failed to copy branch name",
    );
  });
});
