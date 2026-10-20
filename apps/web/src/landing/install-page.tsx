import { useEffect, useRef } from "react";

import { useInitAnalytics } from "./analytics";
import {
  DESKTOP_DOWNLOADS,
  DISCORD_URL,
  downloadHref,
  type DesktopPlatform,
} from "./site";

const DOWNLOAD_STARTED = "bb:installer-requested";
const PLATFORMS: DesktopPlatform[] = ["macos", "windows", "linux"];
const INSTALLER_DETAILS: Record<DesktopPlatform, string> = {
  macos: "Apple Silicon · DMG",
  windows: "x64 · EXE",
  linux: "x64 · AppImage",
};

function InstallStep({ platform }: { platform: DesktopPlatform }) {
  switch (platform) {
    case "macos":
      return (
        <p>Open the downloaded DMG and follow the installer instructions.</p>
      );
    case "windows":
      return (
        <>
          <p>Open the downloaded EXE and follow the installer instructions.</p>
          <p className="install-note">
            bb requires{" "}
            <a href="https://git-scm.com/install/windows">Git for Windows</a>.
            Install it before opening bb if you don&rsquo;t already have it.
          </p>
        </>
      );
    case "linux":
      return (
        <>
          <p>
            Find the downloaded AppImage in your file manager. Open its
            Properties, then Permissions, allow it to run as a program, and open
            the file.
          </p>
          <p className="install-note">
            AppImages normally use FUSE. If the file won&rsquo;t open, see the{" "}
            <a href="https://docs.appimage.org/user-guide/troubleshooting/fuse.html">
              AppImage FUSE guide
            </a>
            .
          </p>
        </>
      );
  }
}

export function InstallPage({ platform }: { platform: DesktopPlatform }) {
  const downloadLink = useRef<HTMLAnchorElement>(null);
  const download = DESKTOP_DOWNLOADS[platform];

  useInitAnalytics();

  useEffect(() => {
    const state: unknown = window.history.state;
    const entry = state !== null && typeof state === "object" ? state : {};
    if (DOWNLOAD_STARTED in entry && entry[DOWNLOAD_STARTED] === true) {
      return;
    }
    window.history.replaceState({ ...entry, [DOWNLOAD_STARTED]: true }, "");
    downloadLink.current?.click();
  }, [platform]);

  return (
    <div className="install-wrap">
      <header className="install-header">
        <a className="logo" href="/" aria-label="bb home">
          <span className="bb-mark logo-mark" />
        </a>
      </header>
      <main className="install-main">
        <div className="install-intro">
          <p className="install-platform">
            {download.label} · {INSTALLER_DETAILS[platform]}
          </p>
          <h1>Your download is starting</h1>
          <p className="install-retry">
            If it doesn&rsquo;t start,{" "}
            <a ref={downloadLink} href={`/install/${platform}/file`} download>
              download again
            </a>
            .
          </p>
        </div>

        <ol className="install-steps">
          <li>
            <h2>Install bb</h2>
            <InstallStep platform={platform} />
          </li>
          <li>
            <h2>Sign in to a coding agent</h2>
            <p>
              Install and sign in to the coding agent you want to use with bb.
            </p>
          </li>
          <li>
            <h2>Start your first thread</h2>
            <p>
              Open bb, add your project folder, and type your first request.
            </p>
          </li>
        </ol>

        <footer className="install-footer">
          <p>
            Need a hand? <a href={DISCORD_URL}>Ask on Discord</a>.
          </p>
          <div className="install-alternatives">
            <span>On another computer?</span>
            {PLATFORMS.filter((other) => other !== platform).map((other) => (
              <a key={other} href={downloadHref(other, "footer")}>
                {DESKTOP_DOWNLOADS[other].label}
              </a>
            ))}
          </div>
        </footer>
      </main>
    </div>
  );
}
