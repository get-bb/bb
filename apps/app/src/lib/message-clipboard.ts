import { PROMPT_ATTACHMENT_MAX_BYTES } from "@bb/domain";
import { escapeHtmlText } from "@bb/text-utils";
import { z } from "zod";

const messageClipboardSchema = z
  .object({
    version: z.literal(1),
    text: z.string().min(1).max(100000),
    imageUrl: z.url().max(4096),
  })
  .strict();

export function buildMessageClipboardHtml(
  text: string,
  imageUrl: string,
): string {
  const payload = JSON.stringify({ version: 1, text, imageUrl });
  return `<meta name="bb-message" content="${escapeHtmlText(payload)}"><pre>${escapeHtmlText(text)}</pre><img src="${escapeHtmlText(imageUrl)}">`;
}

export function readMessageClipboardHtml(html: string) {
  if (html.length > 1000000) return null;
  const document = new DOMParser().parseFromString(html, "text/html");
  const metadata = document.querySelector('meta[name="bb-message"]');
  const raw = metadata?.getAttribute("content");
  if (!raw) return null;
  try {
    const parsed = messageClipboardSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const image = new URL(parsed.data.imageUrl);
    if (
      image.origin !== window.location.origin ||
      !["http:", "https:"].includes(image.protocol) ||
      image.username ||
      image.password
    )
      return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function readMessageClipboardImage(
  imageUrl: string,
  signal: AbortSignal,
): Promise<File> {
  const response = await fetch(imageUrl, {
    signal,
    credentials: "same-origin",
    redirect: "error",
  });
  const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (!response.ok || !type?.startsWith("image/") || !response.body)
    throw new Error("Copied image unavailable");
  if (
    Number(response.headers.get("content-length")) > PROMPT_ATTACHMENT_MAX_BYTES
  )
    throw new Error("Copied image exceeds 35 MB");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PROMPT_ATTACHMENT_MAX_BYTES)
        throw new Error("Copied image exceeds 35 MB");
      chunks.push(Uint8Array.from(value));
    }
  } finally {
    await reader.cancel();
  }
  if (size === 0) throw new Error("Copied image is empty");
  const url = new URL(imageUrl);
  const path = url.searchParams.get("path") ?? url.pathname;
  const name = path.split("/").at(-1) || "copied-image";
  return new File(chunks, name, { type });
}
