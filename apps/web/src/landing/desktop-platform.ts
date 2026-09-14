import { useEffect, useState } from "react";

import { DEFAULT_DESKTOP_PLATFORM } from "./site";
import type { DesktopPlatform } from "./site";

type PlatformSource = {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string } | null;
};

export function detectDesktopPlatform(
  source: PlatformSource,
): DesktopPlatform | null {
  const hint = source.userAgentData?.platform ?? source.platform ?? "";
  const userAgent = source.userAgent ?? "";
  if (/mac/i.test(hint) && !/iphone|ipad|ipod/i.test(userAgent)) {
    return "macos";
  }
  if (
    /linux/i.test(hint) &&
    !/android/i.test(hint) &&
    !/android|cros/i.test(userAgent)
  ) {
    return "linux";
  }
  return null;
}

export function useDesktopPlatform(): DesktopPlatform {
  const [platform, setPlatform] = useState<DesktopPlatform>(
    DEFAULT_DESKTOP_PLATFORM,
  );
  useEffect(() => {
    const detected = detectDesktopPlatform(
      navigator as Navigator & PlatformSource,
    );
    if (detected) {
      setPlatform(detected);
    }
  }, []);
  return platform;
}
