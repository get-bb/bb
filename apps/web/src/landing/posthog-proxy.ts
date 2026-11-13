export const POSTHOG_PROXY_PATH = "/relay";
export const POSTHOG_UI_HOST = "https://us.posthog.com";

const API_HOST = "us.i.posthog.com";
const ASSET_HOST = "us-assets.i.posthog.com";
const POSTHOG_KEY_AUTHORIZATION = /^Bearer ph[csx]_/;

export type PostHogProxyCache = {
  match: (request: Request) => Promise<Response | undefined>;
  put: (request: Request, response: Response) => Promise<void>;
};

export type PostHogProxyDeps = {
  fetch: typeof fetch;
  cache: PostHogProxyCache;
  waitUntil: (promise: Promise<unknown>) => void;
};

export function postHogProxyPath(pathname: string): string | null {
  if (pathname === POSTHOG_PROXY_PATH) return "/";
  if (!pathname.startsWith(`${POSTHOG_PROXY_PATH}/`)) return null;
  return pathname.slice(POSTHOG_PROXY_PATH.length);
}

export async function proxyPostHogRequest(
  request: Request,
  deps: PostHogProxyDeps,
): Promise<Response | null> {
  const url = new URL(request.url);
  const upstreamPath = postHogProxyPath(url.pathname);
  if (upstreamPath === null) return null;
  const pathWithSearch = upstreamPath + url.search;
  if (
    upstreamPath.startsWith("/static/") ||
    upstreamPath.startsWith("/array/")
  ) {
    return retrieveAsset(request, pathWithSearch, deps);
  }
  return forwardRequest(request, pathWithSearch, deps);
}

async function retrieveAsset(
  request: Request,
  pathWithSearch: string,
  deps: PostHogProxyDeps,
): Promise<Response> {
  const cached = await deps.cache.match(request);
  if (cached) return cached;
  const response = await deps.fetch(`https://${ASSET_HOST}${pathWithSearch}`);
  if (response.ok) {
    deps.waitUntil(deps.cache.put(request, response.clone()));
  }
  return response;
}

async function forwardRequest(
  request: Request,
  pathWithSearch: string,
  deps: PostHogProxyDeps,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  if (!POSTHOG_KEY_AUTHORIZATION.test(headers.get("authorization") ?? "")) {
    headers.delete("authorization");
  }
  headers.set("x-forwarded-for", request.headers.get("cf-connecting-ip") ?? "");
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return deps.fetch(
    new Request(`https://${API_HOST}${pathWithSearch}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : null,
      redirect: request.redirect,
    }),
  );
}
