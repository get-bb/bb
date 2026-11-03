import type { ReactNode } from "react";

import { DesktopDownloadButton } from "./cta";
import { EmailDownloadLinkForm } from "./email-download-link-form";
import { SendToComputerButton } from "./send-to-computer-button";
import type { CtaPlacement, DesktopPlatform } from "./site";

export type TouchAction = "share" | "email";

const PLATFORMS_NOTE = "bb runs on macOS, Windows, and Linux";

export function DesktopInstallChoice({
  placement,
  platform,
  note,
  touchNote = PLATFORMS_NOTE,
  touchAction = "share",
}: {
  placement: CtaPlacement;
  platform: DesktopPlatform;
  note: ReactNode;
  touchNote?: ReactNode;
  touchAction?: TouchAction;
}) {
  return (
    <span className="install-choice">
      <DesktopDownloadButton
        placement={placement}
        platform={platform}
        className="btn btn-primary btn-install desktop-only"
      />
      {touchAction === "email" ? (
        <EmailDownloadLinkForm placement={placement} />
      ) : (
        <SendToComputerButton placement={placement} />
      )}
      <span className="install-note desktop-only">{note}</span>
      <span className="install-note touch-only">{touchNote}</span>
    </span>
  );
}
