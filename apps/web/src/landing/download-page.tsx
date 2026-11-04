import { mobileAppDownloads } from "@bb/domain/mobile-app";
import AndroidIcon from "@hugeicons/core-free-icons/AndroidIcon";
import AppleIcon from "@hugeicons/core-free-icons/AppleIcon";
import { HugeiconsIcon } from "@hugeicons/react";

import { trackLandingEvent } from "./analytics";
import { CommandButton } from "./command-button";
import { DesktopDownloadIcon, DownloadLink } from "./cta";
import { useDesktopPlatform } from "./desktop-platform";
import { DesktopInstallChoice } from "./install-choice";
import { SiteFooter, SiteNav } from "./site-chrome";
import { CLI_COMMAND, DESKTOP_DOWNLOADS } from "./site";
import type { DesktopPlatform } from "./site";

export const DOWNLOAD_PAGE_TITLE = "Download bb";
const PLACEMENT = "download_page";

type DownloadKind = DesktopPlatform | "terminal" | "ios" | "android";

const ROWS: Record<DownloadKind, { name: string; tag: string }> = {
  macos: { name: "macOS", tag: DESKTOP_DOWNLOADS.macos.note },
  windows: { name: "Windows", tag: DESKTOP_DOWNLOADS.windows.note },
  linux: { name: "Linux", tag: DESKTOP_DOWNLOADS.linux.note },
  terminal: { name: "Terminal", tag: "Intel Macs, servers" },
  ios: { name: "iPhone", tag: "Beta · TestFlight" },
  android: { name: "Android", tag: "Alpha · APK" },
};

const COMPUTER_KINDS = ["macos", "windows", "linux", "terminal"] as const;
const PHONE_KINDS = ["ios", "android"] as const;

function RowAction({ kind }: { kind: DownloadKind }) {
  switch (kind) {
    case "terminal":
      return (
        <CommandButton
          command={CLI_COMMAND}
          label={`Copy install command: ${CLI_COMMAND}`}
          size="compact"
          onCopy={() =>
            trackLandingEvent({
              name: "landing_cli_command_copied",
              properties: { placement: PLACEMENT, command: CLI_COMMAND },
            })
          }
        />
      );
    case "ios":
      return (
        <a className="btn btn-sm btn-ghost" href={mobileAppDownloads.ios}>
          <HugeiconsIcon icon={AppleIcon} className="btn-ic" aria-hidden />
          Join beta
        </a>
      );
    case "android":
      return (
        <a className="btn btn-sm btn-ghost" href={mobileAppDownloads.android}>
          <HugeiconsIcon icon={AndroidIcon} className="btn-ic" aria-hidden />
          Download
        </a>
      );
    default:
      return (
        <DownloadLink
          placement={PLACEMENT}
          platform={kind}
          className="btn btn-sm btn-ghost"
        >
          <DesktopDownloadIcon platform={kind} />
          Download
        </DownloadLink>
      );
  }
}

function DownloadRows({
  kinds,
  className = "dl-rows",
}: {
  kinds: readonly DownloadKind[];
  className?: string;
}) {
  return (
    <div className={className}>
      {kinds.map((kind) => (
        <div className="dl-row" key={kind}>
          <span className="dl-row-name">{ROWS[kind].name}</span>
          <span className="dl-row-tag">{ROWS[kind].tag}</span>
          <span className="dl-row-action">
            <RowAction kind={kind} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function DownloadPage() {
  const platform = useDesktopPlatform();
  const { note } = DESKTOP_DOWNLOADS[platform];
  return (
    <div className="wrap">
      <SiteNav />
      <header className="hero dl-hero">
        <h1 aria-label={DOWNLOAD_PAGE_TITLE}>
          Download <span className="dl-mark" aria-hidden="true" />
        </h1>
        <p className="sub">
          For macOS, Windows, Linux, iPhone, and Android. Free and open source.
        </p>
        <div className="dl-hero-actions">
          <DesktopInstallChoice
            placement={PLACEMENT}
            platform={platform}
            note={note}
          />
        </div>
      </header>
      <div className="dl-body">
        <DownloadRows
          kinds={COMPUTER_KINDS.filter((kind) => kind !== platform)}
          className="dl-rows dl-computers"
        />
        <h2 className="dl-h2">Phones</h2>
        <DownloadRows kinds={PHONE_KINDS} />
      </div>
      <SiteFooter />
    </div>
  );
}
