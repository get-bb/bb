import {
  DESKTOP_DOWNLOADS,
  DOWNLOAD_FALLBACK_URL,
  DOWNLOAD_RELEASE_ASSET_BASE_URL,
  CAMPAIGN_PARAM_NAMES,
  CLICK_ID_PARAM_NAMES,
  DOWNLOAD_PAGE_PATH,
  SEND_LINK_VIA_PARAM,
  VISIT_PARAM_NAMES,
  parseSendLinkVia,
} from "./site";
import type { CtaPlacement, DesktopPlatform, SendLinkVia } from "./site";

const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/capture/?ip=0";
const TRACKING_SOURCE = "landing_worker_redirect";
const MAX_URL_PROPERTY_LENGTH = 2048;
const RESEND_CONTACTS_URL = "https://api.resend.com/audiences";
const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const RESEND_GLOBAL_CONTACTS_URL = "https://api.resend.com/contacts";
const MAX_CAMPAIGN_VALUE_LENGTH = 200;
const MAX_SEARCH_LENGTH = 2048;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTHOG_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PATH_LENGTH = 512;

type DownloadPlacement = CtaPlacement | "direct";

type MarketingEnv = {
  LANDING_POSTHOG_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_AUDIENCE_ID?: string;
};

type DownloadLinkEnv = {
  APP_URL: string;
  RESEND_API_KEY?: string;
  RESEND_DOWNLOAD_LINK_AUDIENCE_ID?: string;
  RESEND_DOWNLOAD_LINK_FROM?: string;
  RESEND_DOWNLOAD_LINK_REPLY_TO?: string;
  EMAIL_LINK_IP_RATE_LIMITER: AdmissionLimiter;
  EMAIL_LINK_SITE_RATE_LIMITER: AdmissionLimiter;
};

type AdmissionLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

const EMAIL_LINK_SITE_KEY = "email-download-link";

type DownloadEventProperties = {
  $current_url: string;
  $referrer?: string;
  $session_id?: string;
  download_target: DesktopPlatform;
  first_page?: string;
  first_referrer?: string;
  gbraid?: string;
  gclid?: string;
  placement: DownloadPlacement;
  send_link_via?: SendLinkVia;
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

  const email = parseEmail(await readPayload(request));
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

async function readPayload(
  request: Request,
): Promise<Record<string, unknown> | null> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return null;
  }
  return isRecord(payload) ? payload : null;
}

function parseEmail(payload: Record<string, unknown> | null): string | null {
  const value = payload?.email;
  if (typeof value !== "string") {
    return null;
  }
  const email = value.trim();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return null;
  }
  return email;
}

function parseCampaignParams(value: unknown): URLSearchParams {
  const campaign = new URLSearchParams();
  if (typeof value !== "string" || value.length > MAX_SEARCH_LENGTH) {
    return campaign;
  }
  const params = new URLSearchParams(value);
  for (const name of CAMPAIGN_PARAM_NAMES) {
    const param = params.get(name);
    if (param && param.length <= MAX_CAMPAIGN_VALUE_LENGTH) {
      campaign.set(name, param);
    }
  }
  return campaign;
}

export function emailDownloadLinkUrl(
  appUrl: string,
  campaign: URLSearchParams,
): string {
  const link = new URL(DOWNLOAD_PAGE_PATH, appUrl);
  for (const [name, value] of campaign) {
    link.searchParams.set(name, value);
  }
  link.searchParams.set(SEND_LINK_VIA_PARAM, "email");
  return link.href;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function downloadLinkEmail(
  link: string,
  siteHost: string,
): { subject: string; html: string; text: string } {
  const note = `You asked for this link on ${siteHost}. We won't email you again.`;
  const href = escapeHtml(link);
  return {
    subject: "Your bb download link",
    html: [
      '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">',
      `<p style="margin:0 0 20px"><a href="${href}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#111;color:#fff;font-weight:600;text-decoration:none">Download bb</a></p>`,
      `<p style="margin:0 0 12px">${escapeHtml(note)}</p>`,
      `<p style="margin:0;font-size:13px;color:#666">Or open this link on your computer: <a href="${href}" style="color:#666;word-break:break-all;overflow-wrap:anywhere">${href}</a></p>`,
      "</div>",
    ].join(""),
    text: `Download bb: ${link}\n\n${note}\n`,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function downloadLinkIdempotencyKey(
  email: string,
  now: Date,
): Promise<string> {
  const day = now.toISOString().slice(0, 10);
  return `download-link/${await sha256Hex(email.toLowerCase())}/${day}`;
}

type ContactRequest = {
  email: string;
  segmentId: string;
  headers: Record<string, string>;
};

async function addDownloadLinkContact(args: ContactRequest): Promise<void> {
  const created = await fetch(RESEND_GLOBAL_CONTACTS_URL, {
    body: JSON.stringify({
      email: args.email,
      unsubscribed: true,
      segments: [{ id: args.segmentId }],
    }),
    headers: args.headers,
    method: "POST",
  });
  if (created.ok) {
    return;
  }
  const added = await fetch(
    `${RESEND_GLOBAL_CONTACTS_URL}/${encodeURIComponent(args.email)}/segments/${args.segmentId}`,
    { headers: args.headers, method: "POST" },
  );
  if (!added.ok) {
    throw new Error("contact not added");
  }
}

async function admitEmailLink(
  request: Request,
  env: DownloadLinkEnv,
): Promise<boolean> {
  const clientIp =
    request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  try {
    const perIp = await env.EMAIL_LINK_IP_RATE_LIMITER.limit({ key: clientIp });
    if (!perIp.success) {
      return false;
    }
    const siteWide = await env.EMAIL_LINK_SITE_RATE_LIMITER.limit({
      key: EMAIL_LINK_SITE_KEY,
    });
    return siteWide.success;
  } catch {
    return false;
  }
}

function logContactFailure(): void {
  console.log(
    JSON.stringify({ event: "download_link_contact", outcome: "failed" }),
  );
}

export async function handleEmailDownloadLink(
  request: Request,
  env: DownloadLinkEnv,
  waitUntil: (promise: Promise<void>) => void,
  now: () => Date = () => new Date(),
): Promise<Response> {
  const apiKey = env.RESEND_API_KEY;
  const segmentId = env.RESEND_DOWNLOAD_LINK_AUDIENCE_ID;
  const from = env.RESEND_DOWNLOAD_LINK_FROM;
  if (!apiKey || !segmentId || !from) {
    return jsonResponse({ error: "not_configured" }, 503);
  }
  const payload = await readPayload(request);
  const email = parseEmail(payload);
  if (!email) {
    return jsonResponse({ error: "invalid_email" }, 400);
  }
  if (!(await admitEmailLink(request, env))) {
    return jsonResponse({ error: "send_failed" }, 502);
  }
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };

  let sent: Response;
  try {
    const link = emailDownloadLinkUrl(
      env.APP_URL,
      parseCampaignParams(payload?.search),
    );
    sent = await fetch(RESEND_EMAILS_URL, {
      body: JSON.stringify({
        from,
        to: [email],
        ...(env.RESEND_DOWNLOAD_LINK_REPLY_TO
          ? { reply_to: env.RESEND_DOWNLOAD_LINK_REPLY_TO }
          : {}),
        ...downloadLinkEmail(link, new URL(env.APP_URL).host),
      }),
      headers: {
        ...headers,
        "Idempotency-Key": await downloadLinkIdempotencyKey(email, now()),
      },
      method: "POST",
    });
  } catch {
    return jsonResponse({ error: "send_failed" }, 502);
  }
  if (!sent.ok && sent.status !== 409) {
    return jsonResponse({ error: "send_failed" }, 502);
  }
  waitUntil(
    addDownloadLinkContact({ email, segmentId, headers }).catch(
      logContactFailure,
    ),
  );
  return jsonResponse({ ok: true }, 200);
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
    distinct_id:
      parsePostHogId(args.requestUrl.searchParams.get("visitor_id")) ??
      crypto.randomUUID(),
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
  const globalPrivacyControl = args.request.headers.get("Sec-GPC") === "1";
  const requestUrl = new URL(args.requestUrl);
  for (const name of VISIT_PARAM_NAMES) {
    requestUrl.searchParams.delete(name);
  }
  let referrer = args.request.headers.get("referer");
  if (globalPrivacyControl) {
    for (const name of CLICK_ID_PARAM_NAMES) {
      requestUrl.searchParams.delete(name);
    }
    if (referrer) {
      try {
        const referrerUrl = new URL(referrer);
        for (const name of CLICK_ID_PARAM_NAMES) {
          referrerUrl.searchParams.delete(name);
        }
        referrer = referrerUrl.href;
      } catch {
        referrer = null;
      }
    }
  }
  const referrerSearchParams = readReferrerSearchParams(referrer);
  const properties: DownloadEventProperties = {
    $current_url: truncateProperty(requestUrl.href),
    download_target: args.platform,
    placement: parseDownloadPlacement(args.requestUrl.searchParams),
    tracking_source: TRACKING_SOURCE,
  };

  if (referrer) {
    properties.$referrer = truncateProperty(referrer);
  }
  const sendLinkVia = parseSendLinkVia(
    referrerSearchParams?.get(SEND_LINK_VIA_PARAM) ?? null,
  );
  if (sendLinkVia) {
    properties.send_link_via = sendLinkVia;
  }

  const searchParams = args.requestUrl.searchParams;
  const sessionId = parsePostHogId(searchParams.get("session_id"));
  if (sessionId) {
    properties.$session_id = sessionId;
  }
  const firstPage = parseFirstPage(searchParams.get("first_page"));
  if (firstPage) {
    properties.first_page = firstPage;
  }
  const firstReferrer = parseFirstReferrer(searchParams.get("first_referrer"));
  if (firstReferrer) {
    properties.first_referrer = firstReferrer;
  }

  addUtmProperties({
    properties,
    referrerSearchParams,
    requestSearchParams: requestUrl.searchParams,
  });

  return properties;
}

function parsePostHogId(value: string | null): string | null {
  return value && POSTHOG_ID_PATTERN.test(value) ? value : null;
}

function parseFirstPage(value: string | null): string | null {
  if (
    !value ||
    value.length > MAX_PATH_LENGTH ||
    !/^\/(?!\/)[^\s?#\\]*$/.test(value)
  ) {
    return null;
  }
  return value;
}

function parseFirstReferrer(value: string | null): string | null {
  if (!value) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  return url.origin;
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
    case "download_page":
      return "download_page";
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
