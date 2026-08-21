import { Platform, Share } from "react-native";

/**
 * Outbound sharing: the thread's web URL through the OS share sheet
 * (`Share.share`). Pure content builder + a thin adapter.
 */

export interface ThreadShareContent {
  title: string;
  url: string;
}

export interface SharePayload {
  /** `Share.share` content: iOS shares `url` natively; Android needs `message`. */
  content: { title: string; url: string } | { title: string; message: string };
  options: { dialogTitle: string; subject: string };
}

/**
 * iOS accepts a real `url` item (apps like Messages / Notes render it as a
 * link); Android's `Share.share` only reads `message`, so the URL goes there.
 */
function buildSharePayload(
  platform: "ios" | "android" | "web" | "windows" | "macos",
  { title, url }: ThreadShareContent,
): SharePayload {
  const label = title.trim().length > 0 ? title.trim() : "bb thread";
  return {
    content:
      platform === "ios"
        ? { title: label, url }
        : { title: label, message: url },
    options: { dialogTitle: `Share ${label}`, subject: label },
  };
}

export type ShareOutcome = "shared" | "dismissed";

/** Present the OS share sheet for a thread link. Rejects on a platform error. */
export async function shareThreadLink(
  content: ThreadShareContent,
): Promise<ShareOutcome> {
  const payload = buildSharePayload(Platform.OS, content);
  const result = await Share.share(payload.content, payload.options);
  return result.action === Share.dismissedAction ? "dismissed" : "shared";
}
