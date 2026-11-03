import type { ReactNode } from "react";

import { DesktopDownloadButton } from "./cta";
import { SendToComputerButton } from "./send-to-computer-button";
import type { CtaPlacement, DesktopPlatform } from "./site";

export function DesktopInstallChoice({
  placement,
  platform,
  note,
}: {
  placement: CtaPlacement;
  platform: DesktopPlatform;
  note: ReactNode;
}) {
  return (
    <span className="install-choice">
      <DesktopDownloadButton
        placement={placement}
        platform={platform}
        className="btn btn-primary btn-install install-download"
      />
      <SendToComputerButton placement={placement} />
      <span className="install-note install-note-desktop">{note}</span>
      <span className="install-note install-note-touch">
        bb runs on macOS, Windows, and Linux
      </span>
    </span>
  );
}
