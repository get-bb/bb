import { DesktopDownloadButton } from "./cta";
import { SendToComputerButton } from "./send-to-computer-button";
import type { CtaPlacement, DesktopPlatform } from "./site";

export function DesktopInstallChoice({
  placement,
  platform,
}: {
  placement: CtaPlacement;
  platform: DesktopPlatform;
}) {
  return (
    <span className="install-choice">
      <DesktopDownloadButton
        placement={placement}
        platform={platform}
        className="btn btn-primary btn-install install-download"
      />
      <SendToComputerButton placement={placement} />
      <span className="install-note install-note-touch">
        bb runs on macOS, Windows, and Linux
      </span>
    </span>
  );
}
