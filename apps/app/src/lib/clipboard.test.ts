// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: toastMocks,
}));

import {
  copyTextToClipboard,
  copyToClipboardWithToast,
} from "./clipboard";

function installClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

function removeClipboard(): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
}

function installEditingCommand(
  implementation: (command: string) => boolean,
) {
  const execCommand = vi.fn(implementation);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
  return execCommand;
}

afterEach(() => {
  document.body.replaceChildren();
  toastMocks.error.mockReset();
  toastMocks.success.mockReset();
  vi.restoreAllMocks();
  removeClipboard();
});

describe("copyTextToClipboard", () => {
  it("uses the Clipboard API when it succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const editingCopy = installEditingCommand(() => true);
    installClipboard(writeText);

    await expect(copyTextToClipboard("hello")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(editingCopy).not.toHaveBeenCalled();
  });

  it.each([
    ["is unavailable", false],
    ["rejects", true],
  ])(
    "falls back to the editing command when the Clipboard API %s",
    async (_label, clipboardRejects) => {
      if (clipboardRejects) {
        installClipboard(
          vi.fn().mockRejectedValue(new DOMException("Not allowed")),
        );
      } else {
        removeClipboard();
      }
      const editingCopy = installEditingCommand(() => {
        const textarea = document.querySelector("textarea");
        expect(textarea?.value).toBe("LAN copy");
        return true;
      });

      await expect(copyTextToClipboard("LAN copy")).resolves.toBe(true);

      expect(editingCopy).toHaveBeenCalledWith("copy");
      expect(document.querySelector("textarea")).toBeNull();
    },
  );

  it("restores focus and reports failure when both copy methods fail", async () => {
    removeClipboard();
    installEditingCommand(() => false);
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();

    await expect(copyTextToClipboard("nope")).resolves.toBe(false);

    expect(document.activeElement).toBe(button);
    expect(document.querySelector("textarea")).toBeNull();
  });
});

describe("copyToClipboardWithToast", () => {
  it("shows the configured error only after both copy methods fail", async () => {
    installClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    installEditingCommand(() => false);

    await expect(
      copyToClipboardWithToast("text", {
        errorMessage: "Couldn't copy",
        successMessage: "Copied it",
      }),
    ).resolves.toBe(false);

    expect(toastMocks.error).toHaveBeenCalledWith("Couldn't copy");
    expect(toastMocks.success).not.toHaveBeenCalled();
  });
});
