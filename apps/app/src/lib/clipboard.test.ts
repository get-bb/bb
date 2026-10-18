// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));
const nativeMocks = vi.hoisted(() => ({ getNativeShell: vi.fn() }));
vi.mock("@/lib/native-shell/native-shell", () => nativeMocks);

vi.mock("@/components/ui/app-toast", () => ({
  appToast: toastMocks,
}));

import { copyToClipboard, copyToClipboardWithToast } from "./clipboard";
import { readMessageClipboardHtml } from "./message-clipboard";

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

function installEditingCommand(implementation: (command: string) => boolean) {
  const execCommand = vi.fn(implementation);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
  return execCommand;
}

function dispatchCopyEvent(target: EventTarget): Map<string, string> {
  const data = new Map<string, string>();
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { setData: (type: string, value: string) => data.set(type, value) },
  });
  target.dispatchEvent(event);
  return data;
}

afterEach(() => {
  document.body.replaceChildren();
  toastMocks.error.mockReset();
  toastMocks.success.mockReset();
  nativeMocks.getNativeShell.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  removeClipboard();
});

describe("copyToClipboard", () => {
  it("writes through the desktop clipboard before the browser APIs", async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("bbDesktop", { writeClipboard });
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    vi.stubGlobal("ClipboardItem", class {});
    const editingCopy = installEditingCommand(() => true);

    await expect(
      copyToClipboard({ text: "link", html: "<a>link</a>" }),
    ).resolves.toBe(true);

    expect(writeClipboard).toHaveBeenCalledWith({
      text: "link",
      html: "<a>link</a>",
    });
    expect(write).not.toHaveBeenCalled();
    expect(editingCopy).not.toHaveBeenCalled();
  });

  it("falls back to the Clipboard API when the desktop clipboard rejects", async () => {
    vi.stubGlobal("bbDesktop", {
      writeClipboard: vi.fn().mockRejectedValue(new Error("not a bb window")),
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard(writeText);

    await expect(copyToClipboard({ text: "hello" })).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("uses the Clipboard API when it succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const editingCopy = installEditingCommand(() => true);
    installClipboard(writeText);

    await expect(copyToClipboard({ text: "hello" })).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(editingCopy).not.toHaveBeenCalled();
  });

  it("writes rich content as one plain and HTML clipboard item", async () => {
    const items: Array<Record<string, Blob>> = [];
    vi.stubGlobal(
      "ClipboardItem",
      class TestClipboardItem {
        constructor(item: Record<string, Blob>) {
          items.push(item);
        }
      },
    );
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });

    await expect(
      copyToClipboard({ text: "plain", html: "<b>rich</b>" }),
    ).resolves.toBe(true);

    expect(write).toHaveBeenCalledOnce();
    await expect(items[0]?.["text/plain"]?.text()).resolves.toBe("plain");
    await expect(items[0]?.["text/html"]?.text()).resolves.toBe("<b>rich</b>");
  });

  it.each([
    ["is unavailable", false],
    ["rejects", true],
  ])(
    "falls back to the copy command without moving focus when the Clipboard API %s",
    async (_label, clipboardRejects) => {
      if (clipboardRejects) {
        installClipboard(
          vi.fn().mockRejectedValue(new DOMException("Not allowed")),
        );
      } else {
        removeClipboard();
      }
      const menuItem = document.createElement("button");
      document.body.append(menuItem);
      menuItem.focus();
      const otherCopyListener = vi.fn();
      document.addEventListener("copy", otherCopyListener);
      let copiedData = new Map<string, string>();
      const editingCopy = installEditingCommand(() => {
        copiedData = dispatchCopyEvent(menuItem);
        return true;
      });

      await expect(copyToClipboard({ text: "LAN copy" })).resolves.toBe(true);

      document.removeEventListener("copy", otherCopyListener);
      expect(editingCopy).toHaveBeenCalledWith("copy");
      expect([...copiedData]).toEqual([["text/plain", "LAN copy"]]);
      expect(otherCopyListener).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(menuItem);
    },
  );

  it("writes rich content through the copy command", async () => {
    removeClipboard();
    let copiedData = new Map<string, string>();
    installEditingCommand(() => {
      copiedData = dispatchCopyEvent(document);
      return true;
    });

    await expect(
      copyToClipboard({ text: "plain", html: "<b>rich</b>" }),
    ).resolves.toBe(true);

    expect(Object.fromEntries(copiedData)).toEqual({
      "text/plain": "plain",
      "text/html": "<b>rich</b>",
    });
  });

  it("reports failure when the copy command succeeds without writing the text", async () => {
    removeClipboard();
    installEditingCommand(() => true);

    await expect(copyToClipboard({ text: "nothing written" })).resolves.toBe(
      false,
    );

    expect(dispatchCopyEvent(document).size).toBe(0);
  });

  it("reports failure when every copy method fails", async () => {
    removeClipboard();
    installEditingCommand(() => false);

    await expect(copyToClipboard({ text: "nope" })).resolves.toBe(false);
  });
});

describe("copyToClipboardWithToast", () => {
  it("copies Android HTML metadata with a plain text fallback", async () => {
    const request = vi.fn().mockResolvedValue({ copied: true });
    nativeMocks.getNativeShell.mockReturnValue({ copyRichText: request });
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });

    await expect(
      copyToClipboardWithToast("A photo", {
        imageUrl: "/attachments/photo.png",
      }),
    ).resolves.toBe(true);

    const [text, html] = request.mock.calls[0] ?? [];
    expect(text).toBe("A photo");
    expect(readMessageClipboardHtml(html)).toEqual({
      version: 1,
      text: "A photo",
      imageUrl: new URL("/attachments/photo.png", window.location.href).href,
    });
    expect(write).not.toHaveBeenCalled();
    expect(toastMocks.success).toHaveBeenCalledWith("Copied");
  });

  it.each(["rejected", "invalid", "foreign image"])(
    "preserves text and reports partial success after a %s native image copy",
    async (failure) => {
      const request =
        failure === "rejected"
          ? vi.fn().mockRejectedValue(new Error("Image unavailable"))
          : vi.fn().mockResolvedValue({});
      nativeMocks.getNativeShell.mockReturnValue({ copyRichText: request });
      const writeText = vi.fn().mockResolvedValue(undefined);
      installClipboard(writeText);

      await expect(
        copyToClipboardWithToast("A photo", {
          imageUrl:
            failure === "foreign image"
              ? "https://other.example/photo.png"
              : "/attachments/photo.png",
        }),
      ).resolves.toBe(true);

      if (failure === "foreign image") expect(request).not.toHaveBeenCalled();
      expect(writeText).toHaveBeenCalledWith("A photo");
      expect(toastMocks.success).toHaveBeenCalledWith(
        "Copied text; image could not be copied",
      );
    },
  );

  it("reports image-only failure without replacing the clipboard with empty text", async () => {
    nativeMocks.getNativeShell.mockReturnValue({
      copyTextAndImage: vi
        .fn()
        .mockRejectedValue(new Error("Image unavailable")),
    });
    const writeText = vi.fn();
    installClipboard(writeText);

    await expect(
      copyToClipboardWithToast("", { imageUrl: "/attachments/photo.png" }),
    ).resolves.toBe(false);

    expect(writeText).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith("Failed to copy");
  });
  it("writes message text and an attached PNG as one clipboard item", async () => {
    const clipboardData: Record<string, Blob | Promise<Blob>>[] = [];
    class TestClipboardItem {
      constructor(data: Record<string, Blob | Promise<Blob>>) {
        clipboardData.push(data);
      }
    }
    const write = vi.fn(async () => {
      await Promise.all(Object.values(clipboardData[0] ?? {}));
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", TestClipboardItem);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("image", {
          headers: { "Content-Type": "image/png" },
          status: 200,
        }),
      ),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write, writeText },
    });

    await expect(
      copyToClipboardWithToast("A photo", {
        imageUrl: "/attachments/photo.png",
      }),
    ).resolves.toBe(true);

    expect(write).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    const copiedImageBlob = await Promise.resolve(
      clipboardData[0]?.["image/png"],
    );
    expect(copiedImageBlob?.type).toBe("image/png");
    expect(await copiedImageBlob?.text()).toBe("image");
    const textBlob = await Promise.resolve(clipboardData[0]?.["text/plain"]);
    expect(await textBlob?.text()).toBe("A photo");
  });

  it("writes an attached image when the message has no text", async () => {
    const clipboardData: Record<string, Blob | Promise<Blob>>[] = [];
    const write = vi.fn(async () => {
      await Promise.all(Object.values(clipboardData[0] ?? {}));
    });
    vi.stubGlobal(
      "ClipboardItem",
      class TestClipboardItem {
        constructor(data: Record<string, Blob | Promise<Blob>>) {
          clipboardData.push(data);
        }
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("image", {
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });

    await expect(
      copyToClipboardWithToast("", {
        imageUrl: "/attachments/photo.png",
      }),
    ).resolves.toBe(true);

    expect(write).toHaveBeenCalledOnce();
  });

  it("copies text with a partial-success message when the browser cannot write the attached image", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(
      copyToClipboardWithToast("A photo", {
        errorMessage: "Failed to copy",
        imageUrl: "/attachments/photo.png",
      }),
    ).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("A photo");
    expect(toastMocks.success).toHaveBeenCalledWith(
      "Copied text; image could not be copied",
    );
  });

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
