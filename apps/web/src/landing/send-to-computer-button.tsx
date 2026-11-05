import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { copyPlainText } from "../lib/copy-plain-text";
import type { SendToComputerOutcome } from "./analytics";
import { trackLandingEvent } from "./analytics";
import { addSavedUtmParams, readSessionUtm } from "./download-utm";
import type { CtaPlacement } from "./site";
import {
  CAMPAIGN_PARAM_NAMES,
  DOWNLOAD_PAGE_PATH,
  SEND_LINK_VIA_PARAM,
  SITE_TITLE,
} from "./site";

export function sendLinkUrl(
  pageHref: string,
  savedUtm: URLSearchParams = new URLSearchParams(),
): string {
  const page = new URL(pageHref);
  const link = new URL(DOWNLOAD_PAGE_PATH, page.origin);
  const campaignParams: ReadonlyArray<string> = CAMPAIGN_PARAM_NAMES;
  const search = new URLSearchParams(addSavedUtmParams(page.search, savedUtm));
  for (const [name, value] of search) {
    if (campaignParams.includes(name)) {
      link.searchParams.append(name, value);
    }
  }
  link.searchParams.set(SEND_LINK_VIA_PARAM, "share");
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

export type SharedLink = "page" | "download_page";

export function SendToComputerButton({
  placement,
  link,
}: {
  placement: CtaPlacement;
  link: SharedLink;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const send = async () => {
    trackLandingEvent({
      name: "landing_send_to_computer_clicked",
      properties: { placement },
    });
    const outcome = await sendDownloadLink({
      url:
        link === "page"
          ? window.location.href
          : sendLinkUrl(window.location.href, readSessionUtm()),
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
      className="btn btn-primary btn-install install-send touch-only"
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
