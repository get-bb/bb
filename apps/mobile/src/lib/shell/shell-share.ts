import type { BridgeSharePayload } from "@bb/mobile-bridge";

/**
 * Turn a page's share request into `Share.share` arguments. Pure, so the
 * platform difference is testable: iOS renders a real `url` item as a link,
 * and Android reads only `message`.
 */

export interface NativeSharePayload {
  content:
    | { title?: string; url: string }
    | { title?: string; message: string };
  options: { dialogTitle: string; subject?: string };
}

export function buildBridgeSharePayload(
  platform: string,
  payload: BridgeSharePayload,
): NativeSharePayload {
  const title = payload.title?.trim();
  const text = payload.text?.trim() ?? "";
  const url = payload.url ?? "";
  const dialogTitle = title && title.length > 0 ? `Share ${title}` : "Share";
  // A url with no text is the common case (a thread link). iOS gets the real
  // url item; everything else gets one message so nothing is dropped.
  if (platform === "ios" && url.length > 0 && text.length === 0) {
    return {
      content: { title, url },
      options: { dialogTitle, subject: title },
    };
  }
  const message = [text, url && url !== text ? url : ""]
    .filter((part) => part.length > 0)
    .join("\n\n");
  return {
    content: { title, message },
    options: { dialogTitle, subject: title },
  };
}
