type ConnectPublicProtocol = "http:" | "https:";

export function connectPublicProtocol(
  baseDomain: string,
): ConnectPublicProtocol {
  const hostname = new URL(`https://${baseDomain}`).hostname;
  return hostname.endsWith(".localhost") ? "http:" : "https:";
}

export function deriveConnectBaseUrl(serverUrl: string): string {
  return new URL(serverUrl).origin.replace(/\/\/[^.]+\./, "//");
}

export function normalizeConnectOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an http(s) origin`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must be an http(s) origin`);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(`${label} must not contain credentials`);
  }
  if (
    !/^https?:\/\/[^/?#\\\s@]+\/?$/iu.test(value) ||
    url.pathname !== "/" ||
    url.hostname.includes("*")
  ) {
    throw new Error(
      `${label} must be an origin without a path, query or fragment`,
    );
  }
  return url.origin;
}

export function serverUrlForHandle(baseUrl: string, handle: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${handle}.${url.host}`;
}
