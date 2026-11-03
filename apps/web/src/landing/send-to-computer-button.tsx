import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { copyPlainText } from "../lib/copy-plain-text";
import type { SendToComputerOutcome } from "./analytics";
import { trackLandingEvent } from "./analytics";
import type { CtaPlacement } from "./site";
import { CAMPAIGN_PARAM_NAMES, SITE_TITLE } from "./site";

export const SEND_LINK_MARKER = { name: "via", value: "share" } as const;

export function sendLinkUrl(pageHref: string): string {
  const page = new URL(pageHref);
  const link = new URL("/", page.origin);
  const campaignParams: ReadonlyArray<string> = CAMPAIGN_PARAM_NAMES;
  for (const [name, value] of page.searchParams) {
    if (campaignParams.includes(name)) {
      link.searchParams.append(name, value);
    }
  }
  link.searchParams.set(SEND_LINK_MARKER.name, SEND_LINK_MARKER.value);
  return link.href;
}

type ShareData = { title: string; text: string; url: string };

export async function sendDownloadLink({
  url,
  share,
  copy,
}: {
  url: string;
  share: ((data: ShareData) => Promise<void>) | undefined;
  copy: (text: string) => Promise<boolean>;
}): Promise<SendToComputerOutcome> {
  if (share) {
    try {
      await share({
        title: SITE_TITLE,
        text: "Download bb on your computer",
        url,
      });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
    }
  }
  return (await copy(url)) ? "copied" : "copy_failed";
}

export function SendToComputerButton({
  placement,
  className = "btn btn-primary btn-install",
}: {
  placement: CtaPlacement;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const send = async () => {
    trackLandingEvent({
      name: "landing_send_to_computer_clicked",
      properties: { placement },
    });
    const outcome = await sendDownloadLink({
      url: sendLinkUrl(window.location.href),
      share:
        typeof navigator.share === "function"
          ? (data) => navigator.share(data)
          : undefined,
      copy: copyPlainText,
    });
    trackLandingEvent({
      name: "landing_send_to_computer_result",
      properties: { placement, outcome },
    });
    if (outcome === "copied" || outcome === "copy_failed") {
      setStatus(outcome === "copied" ? "copied" : "failed");
      setTimeout(() => setStatus("idle"), 1500);
    }
  };
  return (
    <button
      type="button"
      className={`${className} install-send touch-only`}
      onClick={() => void send()}
    >
      <HugeiconsIcon icon={LaptopIcon} className="btn-ic" />
      Send download link
      <span
        className={status === "idle" ? "cmd-toast" : "cmd-toast show"}
        aria-hidden="true"
      >
        {status === "failed" ? "Copy failed" : "Link copied"}
      </span>
    </button>
  );
}
