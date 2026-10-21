export type DownloadContext = {
  device_class: "desktop" | "phone" | "tablet";
  platform: "darwin" | "win32" | "linux" | "ios" | "android" | "other";
  browser: "safari" | "chrome" | "edge" | "firefox" | "other";
  mac_chip: "apple" | "intel" | "unknown";
  download_repeat: "first" | "repeat" | "unknown";
};

const COOKIE_RESTRICTED_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
  "GB",
  "CH",
]);

export const DOWNLOAD_REPEAT_COOKIE =
  "bb_dl=1; Path=/download; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax";

export function downloadRepeatStatus(
  request: Request,
): DownloadContext["download_repeat"] {
  const cf: unknown = Reflect.get(request, "cf");
  const country =
    typeof cf === "object" &&
    cf !== null &&
    "country" in cf &&
    typeof cf.country === "string"
      ? cf.country.toUpperCase()
      : null;
  if (
    request.headers.get("Sec-GPC") === "1" ||
    country === null ||
    !/^[A-Z]{2}$/.test(country) ||
    country === "XX" ||
    country === "T1" ||
    COOKIE_RESTRICTED_COUNTRIES.has(country)
  ) {
    return "unknown";
  }
  return request.headers
    .get("cookie")
    ?.split(";")
    .some((cookie) => cookie.trim() === "bb_dl=1")
    ? "repeat"
    : "first";
}

export function buildDownloadContext(request: Request): DownloadContext {
  const ua = request.headers.get("user-agent") ?? "";
  const platform: DownloadContext["platform"] = /iPhone|iPad|iPod/i.test(ua)
    ? "ios"
    : /Android/i.test(ua)
      ? "android"
      : /Windows/i.test(ua)
        ? "win32"
        : /Macintosh|Mac OS X/i.test(ua)
          ? "darwin"
          : /Linux/i.test(ua)
            ? "linux"
            : "other";
  const device_class: DownloadContext["device_class"] =
    /iPad|Tablet/i.test(ua) || (platform === "android" && !/Mobile/i.test(ua))
      ? "tablet"
      : /iPhone|iPod|Mobile/i.test(ua)
        ? "phone"
        : "desktop";
  const browser: DownloadContext["browser"] = /Edg(?:e|A|iOS)?\//i.test(ua)
    ? "edge"
    : /OPR\/|Opera|SamsungBrowser\//i.test(ua)
      ? "other"
      : /Chrome\/|Chromium\/|CriOS\//i.test(ua)
        ? "chrome"
        : /Firefox\/|FxiOS\//i.test(ua)
          ? "firefox"
          : /Safari\//i.test(ua)
            ? "safari"
            : "other";
  const arch = request.headers.get("sec-ch-ua-arch")?.trim().toLowerCase();
  const mac_chip: DownloadContext["mac_chip"] =
    platform !== "darwin"
      ? "unknown"
      : arch === '"arm"'
        ? "apple"
        : arch === '"x86"'
          ? "intel"
          : "unknown";
  return {
    device_class,
    platform,
    browser,
    mac_chip,
    download_repeat: downloadRepeatStatus(request),
  };
}
