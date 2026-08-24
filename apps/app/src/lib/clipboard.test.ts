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
  copyRichTextToClipboard,
  copyTextToClipboard,
  copyToClipboardWithToast,
} from "./clipboard";

function installClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

function installRichClipboard(
  write: (items: ClipboardItem[]) => Promise<void>,
): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write },
  });
}

function removeClipboard(): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
}

function installEditingCommand(implementation: (command: string) => boolean) {
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
  Reflect.deleteProperty(globalThis, "ClipboardItem");
});

describe("copyRichTextToClipboard", () => {
  it("writes matching plain and HTML clipboard representations", async () => {
    class TestClipboardItem {
      constructor(readonly data: Record<string, Blob>) {}
    }
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: TestClipboardItem,
    });
    const write = vi.fn().mockResolvedValue(undefined);
    installRichClipboard(write);

    await expect(
      copyRichTextToClipboard({
        text: "@Surface ",
        html: '<span data-prompt-mention="true">@Surface</span> ',
      }),
    ).resolves.toBe(true);

    const item = write.mock.calls[0]?.[0]?.[0] as TestClipboardItem;
    await expect(item.data["text/plain"]?.text()).resolves.toBe("@Surface ");
    await expect(item.data["text/html"]?.text()).resolves.toContain(
      'data-prompt-mention="true"',
    );
  });

  it("does not report a plain-only editing fallback as rich success", async () => {
    removeClipboard();
    installEditingCommand(() => true);

    await expect(
      copyRichTextToClipboard({
        text: "@Surface ",
        html: "<span>Surface</span>",
      }),
    ).resolves.toBe(false);
  });
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
