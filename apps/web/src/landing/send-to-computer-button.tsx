import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { copyPlainText } from "../lib/copy-plain-text";
import { trackLandingEvent } from "./analytics";
import type { CtaPlacement } from "./site";
import { SITE_TITLE, UTM_PARAM_NAMES } from "./site";

export function SendToComputerButton({
  placement,
}: {
  placement: CtaPlacement;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const link = () => {
    const url = new URL(window.location.pathname, "https://getbb.app");
    const current = new URL(window.location.href);
    for (const name of UTM_PARAM_NAMES) {
      const value = current.searchParams.get(name);
      if (value) url.searchParams.set(name, value);
    }
    if (!url.searchParams.has("utm_source"))
      url.searchParams.set("utm_source", "share");
    if (!url.searchParams.has("utm_medium"))
      url.searchParams.set("utm_medium", "referral");
    if (!url.searchParams.has("utm_campaign"))
      url.searchParams.set("utm_campaign", "send-to-computer");
    if (!url.searchParams.has("utm_content"))
      url.searchParams.set("utm_content", "send-to-computer");
    return url.href;
  };
  const recordClick = () => {
    trackLandingEvent({
      name: "landing_send_to_computer_clicked",
      properties: { placement },
    });
  };
  const copy = async () => {
    const copied = await copyPlainText(link());
    setStatus(copied ? "copied" : "failed");
  };
  const send = async () => {
    recordClick();
    const url = link();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: SITE_TITLE,
          text: "Download bb on your computer",
          url,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }
    await copy();
  };
  return (
    <span className="install-phone-actions">
      <button
        type="button"
        className="btn btn-primary btn-install"
        onClick={() => void send()}
      >
        <HugeiconsIcon icon={LaptopIcon} className="btn-ic" />
        Get bb on your computer
      </button>
      <button
        type="button"
        className="install-copy-link"
        onClick={() => {
          recordClick();
          void copy();
        }}
      >
        Copy link
      </button>
      <span className="install-copy-status" role="status">
        {status === "failed"
          ? "Copy failed. Try sharing the link instead."
          : status === "copied"
            ? "Link copied"
            : ""}
      </span>
    </span>
  );
}
