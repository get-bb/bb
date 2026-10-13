import { useEffect, useState } from "react";

import { detectDesktopPlatform, type PlatformSource } from "./desktop-platform";
import { CLI_COMMAND } from "./site";
import type { DesktopPlatform } from "./site";

const APPROVED_INSTALL_CAMPAIGNS: ReadonlySet<string> = new Set([
  "brand-oct26",
  "codex-oct26",
  "agentic-oct26",
  "phone-oct26",
  "parallel-oct26",
  "codex-review-oct26",
  "cursor-oct26",
  "t3-code-oct26",
  "superset-oct26",
  "conductor-oct26",
  "vk-oct26",
  "extend-oct26",
]);

export function installCommandForPage(
  search: string,
  platform: DesktopPlatform | null,
): string {
  if (platform !== "macos" && platform !== "linux") {
    return CLI_COMMAND;
  }
  const campaign = new URLSearchParams(search).get("utm_campaign");
  if (campaign === null || !APPROVED_INSTALL_CAMPAIGNS.has(campaign)) {
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
