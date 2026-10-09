import {
  DESKTOP_DOWNLOADS,
  DOWNLOAD_FALLBACK_URL,
  DOWNLOAD_RELEASE_ASSET_BASE_URL,
  CAMPAIGN_PARAM_NAMES,
} from "./site";
import type { CtaPlacement, DesktopPlatform } from "./site";

const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/capture/?ip=0";
const TRACKING_SOURCE = "landing_worker_redirect";
const MAX_URL_PROPERTY_LENGTH = 2048;
const RESEND_CONTACTS_URL = "https://api.resend.com/audiences";
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type DownloadPlacement = CtaPlacement | "direct";

type MarketingEnv = {
  LANDING_POSTHOG_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_AUDIENCE_ID?: string;
};

type DownloadEventProperties = {
  $current_url: string;
  $referrer?: string;
  download_target: DesktopPlatform;
  gbraid?: string;
  gclid?: string;
  placement: DownloadPlacement;
  tracking_source: typeof TRACKING_SOURCE;
  utm_campaign?: string;
  utm_content?: string;
  utm_medium?: string;
  utm_source?: string;
  utm_term?: string;
  wbraid?: string;
};

type PostHogCapturePayload = {
  api_key: string;
  distinct_id: string;
  event: `landing_download_${DesktopPlatform}_clicked`;
  properties: DownloadEventProperties;
  timestamp: string;
};

type TrackDownloadClickArgs = {
  platform: DesktopPlatform;
  postHogKey: string | undefined;
  request: Request;
  requestUrl: URL;
};

export async function handleDownload(
  platform: DesktopPlatform,
  request: Request,
  env: MarketingEnv,
  waitUntil: (promise: Promise<void>) => void,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const range = request.headers.get("range");
  if (isFirstByteRequest(range)) {
    waitUntil(
      trackDownloadClick({
        platform,
        postHogKey: env.LANDING_POSTHOG_KEY,
        request,
        requestUrl,
      }),
    );
  }
  const asset = await resolveInstallerAsset(platform);
  if (!asset) {
    return redirectResponse(DOWNLOAD_FALLBACK_URL);
  }
  return streamInstaller(asset, range, request.headers.get("if-range"));
}

type InstallerAsset = {
  name: string;
  url: string;
};

function isFirstByteRequest(range: string | null): boolean {
  return range === null || /^bytes=0-/.test(range.trim());
}

async function fetchInstaller(
  url: string,
  range: string | null,
): Promise<Response | null> {
  try {
    return await fetch(
      url,
      range === null ? undefined : { headers: { range } },
    );
  } catch {
    return null;
  }
}

function matchesValidator(headers: Headers, validator: string): boolean {
  const trimmed = validator.trim();
  return (
    trimmed === headers.get("etag") || trimmed === headers.get("last-modified")
  );
}

async function streamInstaller(
  asset: InstallerAsset,
  range: string | null,
  ifRange: string | null,
): Promise<Response> {
  let upstream = await fetchInstaller(asset.url, range);
  if (
    upstream?.status === 206 &&
    ifRange !== null &&
    !matchesValidator(upstream.headers, ifRange)
  ) {
    await upstream.body?.cancel();
    upstream = await fetchInstaller(asset.url, null);
  }
  if (
    !upstream ||
    (upstream.status !== 200 && upstream.status !== 206) ||
    !upstream.body
  ) {
    return redirectResponse(DOWNLOAD_FALLBACK_URL);
  }

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${asset.name}"`,
    "Content-Type": "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of [
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  return new Response(upstream.body, { headers, status: upstream.status });
}

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Cache-Control": "no-store",
      "content-type": "application/json",
    },
    status,
  });
}

export async function handleSubscribe(
  request: Request,
  env: MarketingEnv,
): Promise<Response> {
  if (!env.RESEND_API_KEY || !env.RESEND_AUDIENCE_ID) {
    return jsonResponse({ error: "Email signup is not configured." }, 503);
  }

  const email = await readEmail(request);
  if (!email) {
    return jsonResponse({ error: "Enter a valid email address." }, 400);
  }

  let resendResponse: Response;
  try {
    resendResponse = await fetch(
      `${RESEND_CONTACTS_URL}/${env.RESEND_AUDIENCE_ID}/contacts`,
      {
        body: JSON.stringify({ email, unsubscribed: false }),
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
  } catch {
    return jsonResponse({ error: "Could not reach the signup service." }, 502);
  }

  if (resendResponse.ok || (await isAlreadySubscribed(resendResponse))) {
    return jsonResponse({ ok: true }, 200);
  }
  return jsonResponse({ error: "Could not add you to the list." }, 502);
}

async function readEmail(request: Request): Promise<string | null> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const value = (payload as { email?: unknown }).email;
  if (typeof value !== "string") {
    return null;
  }
  const email = value.trim();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return null;
  }
  return email;
}

async function isAlreadySubscribed(response: Response): Promise<boolean> {
  if (response.status !== 409 && response.status !== 422) {
    return false;
  }
  const body = await response.text();
  return /already/i.test(body);
}

function redirectResponse(location: string): Response {
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: location,
    },
    status: 302,
  });
}

async function resolveInstallerAsset(
  platform: DesktopPlatform,
): Promise<InstallerAsset | null> {
  const download = DESKTOP_DOWNLOADS[platform];
  try {
    const response = await fetch(download.versionFeedUrl, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return null;
    }

    const assetName = findInstallerAssetName(
      await response.json(),
      download.installerExtension,
    );
    if (!assetName) {
      return null;
    }

    return {
      name: assetName,
      url: `${DOWNLOAD_RELEASE_ASSET_BASE_URL}/${encodeURIComponent(assetName)}`,
    };
  } catch {
    return null;
  }
}

function findInstallerAssetName(
  feed: unknown,
  installerExtension: string,
): string | null {
  if (!isRecord(feed) || !Array.isArray(feed.files)) {
    return null;
  }

  for (const file of feed.files) {
    if (!isRecord(file) || typeof file.url !== "string") {
      continue;
    }
    if (isInstallerAssetName(file.url, installerExtension)) {
      return file.url;
    }
  }
  return null;
}

function isInstallerAssetName(
  value: string,
  installerExtension: string,
): boolean {
  return (
    value.length > installerExtension.length &&
    value.endsWith(installerExtension) &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function trackDownloadClick(args: TrackDownloadClickArgs): Promise<void> {
  if (!args.postHogKey) {
    return;
  }

  const payload: PostHogCapturePayload = {
    api_key: args.postHogKey,
    distinct_id: crypto.randomUUID(),
    event: `landing_download_${args.platform}_clicked`,
    properties: buildDownloadEventProperties({
      platform: args.platform,
      request: args.request,
      requestUrl: args.requestUrl,
    }),
    timestamp: new Date().toISOString(),
  };

  await fetch(POSTHOG_CAPTURE_URL, {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).catch(() => {});
}

type BuildDownloadEventPropertiesArgs = {
  platform: DesktopPlatform;
  request: Request;
  requestUrl: URL;
};

function buildDownloadEventProperties(
  args: BuildDownloadEventPropertiesArgs,
): DownloadEventProperties {
  const referrer = args.request.headers.get("referer");
  const referrerSearchParams = readReferrerSearchParams(referrer);
  const properties: DownloadEventProperties = {
    $current_url: truncateProperty(args.requestUrl.href),
    download_target: args.platform,
    placement: parseDownloadPlacement(args.requestUrl.searchParams),
    tracking_source: TRACKING_SOURCE,
  };

  if (referrer) {
    properties.$referrer = truncateProperty(referrer);
  }

  addUtmProperties({
    properties,
    referrerSearchParams,
    requestSearchParams: args.requestUrl.searchParams,
  });

  return properties;
}

function parseDownloadPlacement(
  searchParams: URLSearchParams,
): DownloadPlacement {
  switch (searchParams.get("placement")) {
    case "nav":
      return "nav";
    case "hero":
      return "hero";
    case "closer":
      return "closer";
    case "footer":
      return "footer";
    default:
      return "direct";
  }
}

function readReferrerSearchParams(
  referrer: string | null,
): URLSearchParams | null {
  if (!referrer) {
    return null;
  }

  try {
    return new URL(referrer).searchParams;
  } catch {
    return null;
  }
}

type AddUtmPropertiesArgs = {
  properties: DownloadEventProperties;
  referrerSearchParams: URLSearchParams | null;
  requestSearchParams: URLSearchParams;
};

function addUtmProperties(args: AddUtmPropertiesArgs): void {
  for (const name of CAMPAIGN_PARAM_NAMES) {
    const value = getTrackingParam({
      name,
      referrerSearchParams: args.referrerSearchParams,
      requestSearchParams: args.requestSearchParams,
    });
    if (value) {
      args.properties[name] = value;
    }
  }
}

type GetTrackingParamArgs = {
  name: string;
  referrerSearchParams: URLSearchParams | null;
  requestSearchParams: URLSearchParams;
};

function getTrackingParam(args: GetTrackingParamArgs): string | undefined {
  return (
    getNonEmptySearchParam(args.requestSearchParams, args.name) ??
    getNonEmptySearchParam(args.referrerSearchParams, args.name)
  );
}

function getNonEmptySearchParam(
  searchParams: URLSearchParams | null,
  name: string,
): string | undefined {
  const value = searchParams?.get(name);
  if (!value) {
    return undefined;
  }

  return truncateProperty(value);
}

function truncateProperty(value: string): string {
  if (value.length <= MAX_URL_PROPERTY_LENGTH) {
    return value;
  }

  return value.slice(0, MAX_URL_PROPERTY_LENGTH);
}
