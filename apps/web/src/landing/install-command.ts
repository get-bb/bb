import { useEffect, useState } from "react";

import { detectDesktopPlatform, type PlatformSource } from "./desktop-platform";
import { CLI_COMMAND } from "./site";
import type { DesktopPlatform } from "./site";

const INSTALL_CAMPAIGN_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/u;

export function installCommandForPage(
  search: string,
  platform: DesktopPlatform | null,
): string {
  if (platform !== "macos" && platform !== "linux") {
    return CLI_COMMAND;
  }
  const campaign = new URLSearchParams(search).get("utm_campaign");
  if (campaign === null || !INSTALL_CAMPAIGN_PATTERN.test(campaign)) {
    return CLI_COMMAND;
  }
  return `BB_INSTALL_CAMPAIGN=${campaign} ${CLI_COMMAND}`;
}

export function useInstallCommand(): string {
  const [command, setCommand] = useState(CLI_COMMAND);
  useEffect(() => {
    setCommand(
      installCommandForPage(
        window.location.search,
        detectDesktopPlatform(navigator as Navigator & PlatformSource),
      ),
    );
  }, []);
  return command;
}
