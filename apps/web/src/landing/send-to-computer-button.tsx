import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { copyPlainText } from "../lib/copy-plain-text";
import { trackLandingEvent } from "./analytics";
import type { CtaPlacement } from "./site";
import { SITE_TITLE } from "./site";

export function SendToComputerButton({
  placement,
}: {
  placement: CtaPlacement;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const send = async () => {
    trackLandingEvent({
      name: "landing_send_to_computer_clicked",
      properties: { placement },
    });
    const url = window.location.href;
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
    const copied = await copyPlainText(url);
    setStatus(copied ? "copied" : "failed");
    setTimeout(() => setStatus("idle"), 1500);
  };
  return (
    <button
      type="button"
      className="btn btn-primary btn-install install-send"
      onClick={() => void send()}
    >
      <HugeiconsIcon icon={LaptopIcon} className="btn-ic" />
      Send to my computer
      <span
        className={status === "idle" ? "cmd-toast" : "cmd-toast show"}
        aria-hidden="true"
      >
        {status === "failed" ? "Copy failed" : "Link copied"}
      </span>
    </button>
  );
}
