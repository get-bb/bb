import type { BbSdkTransport } from "./transport.js";

export interface ResolveRealtimeUrlArgs {
  transport: BbSdkTransport;
}

function websocketUrlFromHttpUrl(url: URL): string {
  const websocketUrl = new URL(url.href);
  if (websocketUrl.protocol === "http:") {
    websocketUrl.protocol = "ws:";
  } else if (websocketUrl.protocol === "https:") {
    websocketUrl.protocol = "wss:";
  }
  websocketUrl.pathname = "/ws";
  websocketUrl.search = "";
  websocketUrl.hash = "";
  return websocketUrl.href;
}

function absoluteHttpBaseUrl(baseUrl: string): URL | null {
  try {
    const url = new URL(baseUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

function browserSameOriginRealtimeUrl(): string | null {
  if (typeof location === "undefined") {
    return null;
  }
  const currentUrl = new URL(location.href);
  if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
    return null;
  }
  return websocketUrlFromHttpUrl(currentUrl);
}

export function resolveRealtimeUrl(args: ResolveRealtimeUrlArgs): string {
  const { transport } = args;
  if (transport.realtimeUrl) {
    return transport.realtimeUrl;
  }

  const absoluteBaseUrl = absoluteHttpBaseUrl(transport.baseUrl);
  if (absoluteBaseUrl) {
    return websocketUrlFromHttpUrl(absoluteBaseUrl);
  }

  if (transport.runtime === "browser" || transport.runtime === "injected-app") {
    const sameOriginUrl = browserSameOriginRealtimeUrl();
    if (sameOriginUrl) {
      return sameOriginUrl;
    }
  }

  throw new Error(
    "BB SDK realtime requires an absolute baseUrl or realtimeUrl in this runtime.",
  );
}
