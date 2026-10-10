import type { TipClient } from "./contract.js";

export interface TipClientEnvironment {
  bbDesktop: unknown;
  bb: unknown;
  userAgent: string;
  maxTouchPoints: number;
}

function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function osFromUserAgent(
  userAgent: string,
  maxTouchPoints: number,
): TipClient["os"] {
  if (/android/iu.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/iu.test(userAgent)) return "ios";
  if (/macintosh|mac os x/iu.test(userAgent)) {
    return maxTouchPoints > 1 ? "ios" : "macos";
  }
  if (/windows/iu.test(userAgent)) return "windows";
  if (/linux|x11|cros/iu.test(userAgent)) return "linux";
  return "unknown";
}

function desktopOs(platform: unknown): TipClient["os"] {
  if (platform === "macos" || platform === "windows" || platform === "linux") {
    return platform;
  }
  return "unknown";
}

function nativeOs(
  platform: unknown,
  fallback: TipClient["os"],
): TipClient["os"] {
  return platform === "ios" || platform === "android" ? platform : fallback;
}

export function detectTipClient(environment: TipClientEnvironment): TipClient {
  const userAgentOs = osFromUserAgent(
    environment.userAgent,
    environment.maxTouchPoints,
  );
  if (isRecord(environment.bbDesktop)) {
    return {
      surface: "desktop",
      os: desktopOs(Reflect.get(environment.bbDesktop, "platform")),
    };
  }
  const native = isRecord(environment.bb)
    ? Reflect.get(environment.bb, "native")
    : undefined;
  if (isRecord(native)) {
    return {
      surface: "mobile-app",
      os: nativeOs(Reflect.get(native, "platform"), userAgentOs),
    };
  }
  return {
    surface:
      userAgentOs === "ios" || userAgentOs === "android" ? "mobile-web" : "web",
    os: userAgentOs,
  };
}

export const SIDEBAR_NOTIFICATION_PROMPT_KEY = "bb.sidebar.notificationPrompt";

export interface NotificationEnvironment {
  permission: string | null;
  promptState: string | null;
}

export function hasNotificationNudge(
  environment: NotificationEnvironment,
): boolean {
  return (
    environment.permission === "default" &&
    environment.promptState === "answered"
  );
}

export function readNotificationEnvironment(): NotificationEnvironment {
  let promptState: string | null;
  try {
    promptState = window.localStorage.getItem(SIDEBAR_NOTIFICATION_PROMPT_KEY);
  } catch {
    promptState = null;
  }
  return {
    permission:
      typeof Notification === "undefined" ? null : Notification.permission,
    promptState,
  };
}

export function readTipClientEnvironment(): TipClientEnvironment {
  return {
    bbDesktop: Reflect.get(window, "bbDesktop"),
    bb: Reflect.get(window, "bb"),
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
  };
}
