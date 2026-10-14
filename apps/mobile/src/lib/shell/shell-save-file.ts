import {
  isExternallyOpenable,
  isShellNavigation,
  parseServerUrl,
} from "./shell-url";

export function resolveServerFileUrl(
  url: string,
  serverUrl: string,
): string | null {
  const server = parseServerUrl(serverUrl);
  if (server === null) return null;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  if (target.username !== "" || target.password !== "") return null;
  if (target.origin !== server.origin) return null;
  return target.href;
}

export function isServerApiUrl(url: string, serverUrl: string): boolean {
  if (resolveServerFileUrl(url, serverUrl) === null) return false;
  const server = parseServerUrl(serverUrl);
  if (server === null) return false;
  const { pathname } = new URL(url);
  return (
    pathname.startsWith("/api/") ||
    (server.prefix.length > 0 && pathname.startsWith(`${server.prefix}/api/`))
  );
}

export type OpenWindowAction = "save" | "navigate" | "external" | "ignore";

export function resolveOpenWindowAction(
  url: string,
  serverUrl: string,
): OpenWindowAction {
  if (resolveServerFileUrl(url, serverUrl) === null) {
    return isExternallyOpenable(url) ? "external" : "ignore";
  }
  if (isServerApiUrl(url, serverUrl)) return "save";
  return isShellNavigation(url, serverUrl) ? "navigate" : "external";
}

const SUBFRAME_LOCAL_PROTOCOLS = new Set(["about:", "blob:", "data:"]);

export function allowsSubframeLoad(url: string, serverUrl: string): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (SUBFRAME_LOCAL_PROTOCOLS.has(target.protocol)) return true;
  return resolveServerFileUrl(url, serverUrl) !== null;
}

export function supportsNativeDownloads(nativeModule: unknown): boolean {
  if (
    typeof nativeModule !== "object" ||
    nativeModule === null ||
    !("nativeDownloadsSupported" in nativeModule) ||
    typeof nativeModule.nativeDownloadsSupported !== "function"
  )
    return false;
  try {
    return nativeModule.nativeDownloadsSupported() === true;
  } catch {
    return false;
  }
}
