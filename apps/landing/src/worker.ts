import { DOWNLOAD_MACOS_REDIRECT_PATH, DOWNLOAD_MACOS_URL } from "./site";
import type { CtaPlacement } from "./site";

const POSTHOG_CAPTURE_URL = "https://us.i.posthog.com/capture/?ip=0";
const DOWNLOAD_EVENT_NAME = "landing_download_macos_clicked";
const DOWNLOAD_TARGET = "macos";
const TRACKING_SOURCE = "landing_worker_redirect";
const MAX_URL_PROPERTY_LENGTH = 2048;

type DownloadPlacement = CtaPlacement | "direct";

type LandingWorkerEnv = {
  ASSETS: AssetFetcher;
  LANDING_POSTHOG_KEY?: string;
};

type AssetFetcher = {
  fetch: (request: Request) => Promise<Response>;
};

type WorkerExecutionContext = {
  waitUntil: (promise: Promise<void>) => void;
};

type LandingWorker = {
  fetch: (
    request: Request,
    env: LandingWorkerEnv,
    context: WorkerExecutionContext,
  ) => Promise<Response>;
};

type DownloadEventProperties = {
  "$current_url": string;
  "$referrer"?: string;
  download_target: typeof DOWNLOAD_TARGET;
  placement: DownloadPlacement;
  tracking_source: typeof TRACKING_SOURCE;
  utm_campaign?: string;
  utm_content?: string;
  utm_medium?: string;
  utm_source?: string;
  utm_term?: string;
};

type PostHogCapturePayload = {
  api_key: string;
  distinct_id: string;
  event: typeof DOWNLOAD_EVENT_NAME;
  properties: DownloadEventProperties;
  timestamp: string;
};

type TrackDownloadClickArgs = {
  postHogKey: string | undefined;
  request: Request;
  requestUrl: URL;
};

const worker: LandingWorker = {
  async fetch(request, env, context) {
    const requestUrl = new URL(request.url);
    if (isDownloadMacosRequest(requestUrl)) {
      context.waitUntil(
        trackDownloadClick({
          postHogKey: env.LANDING_POSTHOG_KEY,
          request,
          requestUrl,
        }),
      );
      return redirectToMacosDownload();
    }

    return env.ASSETS.fetch(request);
  },
};

export default worker;

function isDownloadMacosRequest(requestUrl: URL): boolean {
  return (
    requestUrl.pathname === DOWNLOAD_MACOS_REDIRECT_PATH ||
    requestUrl.pathname === `${DOWNLOAD_MACOS_REDIRECT_PATH}/`
  );
}

function redirectToMacosDownload(): Response {
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: DOWNLOAD_MACOS_URL,
    },
    status: 302,
  });
}

async function trackDownloadClick(
  args: TrackDownloadClickArgs,
): Promise<void> {
  if (!args.postHogKey) {
    return;
  }

  const payload: PostHogCapturePayload = {
    api_key: args.postHogKey,
    distinct_id: crypto.randomUUID(),
    event: DOWNLOAD_EVENT_NAME,
    properties: buildDownloadEventProperties({
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
    download_target: DOWNLOAD_TARGET,
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

function readReferrerSearchParams(referrer: string | null): URLSearchParams | null {
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
  const source = getTrackingParam({
    name: "utm_source",
    referrerSearchParams: args.referrerSearchParams,
    requestSearchParams: args.requestSearchParams,
  });
  const medium = getTrackingParam({
    name: "utm_medium",
    referrerSearchParams: args.referrerSearchParams,
    requestSearchParams: args.requestSearchParams,
  });
  const campaign = getTrackingParam({
    name: "utm_campaign",
    referrerSearchParams: args.referrerSearchParams,
    requestSearchParams: args.requestSearchParams,
  });
  const term = getTrackingParam({
    name: "utm_term",
    referrerSearchParams: args.referrerSearchParams,
    requestSearchParams: args.requestSearchParams,
  });
  const content = getTrackingParam({
    name: "utm_content",
    referrerSearchParams: args.referrerSearchParams,
    requestSearchParams: args.requestSearchParams,
  });

  if (source) {
    args.properties.utm_source = source;
  }
  if (medium) {
    args.properties.utm_medium = medium;
  }
  if (campaign) {
    args.properties.utm_campaign = campaign;
  }
  if (term) {
    args.properties.utm_term = term;
  }
  if (content) {
    args.properties.utm_content = content;
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
