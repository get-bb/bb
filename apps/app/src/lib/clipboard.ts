import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { appToast } from "@/components/ui/app-toast";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { getNativeShell } from "@/lib/native-shell/native-shell";
import { buildMessageClipboardHtml } from "./message-clipboard";

interface CopyToClipboardOptions {
  successMessage?: string | null;
  errorMessage?: string | null;
  imageUrl?: string;
}

async function convertImageBlobToPng(blob: Blob): Promise<Blob> {
  if (blob.type.toLowerCase() === "image/png") {
    return blob;
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = document.createElement("img");
    image.src = objectUrl;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("The browser cannot convert the clipboard image");
    }
    context.drawImage(image, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          resolve(pngBlob);
          return;
        }
        reject(new Error("The browser cannot encode the clipboard image"));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fetchClipboardImage(imageUrl: string): Promise<Blob> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(
      `The clipboard image request failed with ${response.status}`,
    );
  }
  return convertImageBlobToPng(await response.blob());
}

export interface ClipboardContent {
  text: string;
  html?: string;
}

async function writeWithDesktopClipboard(
  content: ClipboardContent,
): Promise<boolean> {
  const desktop = getBbDesktopInfo();
  if (desktop?.writeClipboard === undefined) return false;
  try {
    await desktop.writeClipboard(content);
    return true;
  } catch {
    return false;
  }
}

async function writeWithClipboardApi({
  text,
  html,
}: ClipboardContent): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  try {
    if (html === undefined) {
      if (typeof navigator.clipboard?.writeText !== "function") return false;
      await navigator.clipboard.writeText(text);
      return true;
    }
    if (
      typeof navigator.clipboard?.write !== "function" ||
      typeof ClipboardItem === "undefined"
    ) {
      return false;
    }
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

function writeWithCopyCommand({ text, html }: ClipboardContent): boolean {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }

  let written = false;
  const writeCopiedContent = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    if (html !== undefined) event.clipboardData.setData("text/html", html);
    event.preventDefault();
    event.stopImmediatePropagation();
    written = true;
  };
  window.addEventListener("copy", writeCopiedContent, true);
  try {
    return document.execCommand("copy") && written;
  } catch {
    return false;
  } finally {
    window.removeEventListener("copy", writeCopiedContent, true);
  }
}

export async function copyToClipboard(
  content: ClipboardContent,
): Promise<boolean> {
  return (
    (await writeWithDesktopClipboard(content)) ||
    (await writeWithClipboardApi(content)) ||
    writeWithCopyCommand(content)
  );
}

async function copyTextAndImageToClipboard(
  text: string,
  imageUrl: string,
): Promise<boolean> {
  const shell = getNativeShell();
  const image = new URL(imageUrl, window.location.href);
  const absoluteImageUrl = image.href;
  const html = text ? buildMessageClipboardHtml(text, absoluteImageUrl) : "";
  if (html && shell?.copyRichText) {
    if (
      image.origin !== window.location.origin ||
      !["http:", "https:"].includes(image.protocol) ||
      image.username ||
      image.password
    )
      return false;
    try {
      const result = await shell.copyRichText(text, html);
      return z.object({ copied: z.literal(true) }).safeParse(result).success;
    } catch {
      return false;
    }
  }
  if (shell?.copyTextAndImage) {
    try {
      const result = await shell.copyTextAndImage(text, absoluteImageUrl);
      return z.object({ copied: z.literal(true) }).safeParse(result).success;
    } catch {
      return false;
    }
  }
  if (
    typeof navigator === "undefined" ||
    typeof navigator.clipboard?.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    return false;
  }

  try {
    const imageBlob = fetchClipboardImage(imageUrl);
    void imageBlob.catch(() => undefined);
    const clipboardData: Record<string, Blob | Promise<Blob>> = {
      "image/png": imageBlob,
    };
    if (text.length > 0) {
      clipboardData["text/plain"] = new Blob([text], { type: "text/plain" });
      clipboardData["text/html"] = new Blob([html], { type: "text/html" });
    }
    await navigator.clipboard.write([new ClipboardItem(clipboardData)]);
    return true;
  } catch {
    return false;
  }
}

export async function copyToClipboardWithToast(
  text: string,
  {
    successMessage = "Copied",
    errorMessage = "Failed to copy",
    imageUrl,
  }: CopyToClipboardOptions = {},
): Promise<boolean> {
  const copied = imageUrl
    ? await copyTextAndImageToClipboard(text, imageUrl)
    : await copyToClipboard({ text });
  if (copied) {
    if (successMessage) appToast.success(successMessage);
    return true;
  }
  if (imageUrl && text && (await copyToClipboard({ text }))) {
    appToast.success("Copied text; image could not be copied");
    return true;
  }
  if (errorMessage) appToast.error(errorMessage);
  return false;
}

export interface ClipboardCopyOptions extends CopyToClipboardOptions {
  text: string;
}

export function useClipboardCopy({
  text,
  successMessage = null,
  errorMessage = "Failed to copy",
  imageUrl,
}: ClipboardCopyOptions) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  const copy = useCallback(async () => {
    if ((!text && !imageUrl) || copied) return;
    const success = await copyToClipboardWithToast(text, {
      successMessage,
      errorMessage,
      imageUrl,
    });
    if (success) setCopied(true);
  }, [text, imageUrl, copied, successMessage, errorMessage]);

  return { copied, copy };
}
