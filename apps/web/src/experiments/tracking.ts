import { allowsAnalyticsCookie } from "../analytics/cookie-policy";
import { ADS_TEST_PAGES, PAGE_EXPERIMENT_REGISTRY } from "./registry";
import type { PageExperiment } from "./registry";

type Assignment = { experiment: PageExperiment; variant: string };
type Enrollment = {
  assignments: Assignment[];
  visitorId: string | null;
  cookie: string | null;
};

const INTERNAL_COOKIE =
  "bb_internal=1; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax";
const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|bingpreview|googleother|curl|wget|python|node-fetch/i;

function cookieValue(request: Request, name: string): string | null {
  const values =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim()) ?? [];
  const matches = values.filter((part) => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : null;
}

function validVisitorId(value: string | null): value is string {
  return value !== null && /^[a-f0-9]{32}$/.test(value);
}

function eligibleRequest(request: Request): boolean {
  const ua = request.headers.get("user-agent");
  return (
    request.method === "GET" &&
    !!ua?.trim() &&
    !BOT_PATTERN.test(ua) &&
    !/prefetch|prerender/i.test(request.headers.get("sec-purpose") ?? "") &&
    !/prefetch/i.test(request.headers.get("purpose") ?? "") &&
    allowsAnalyticsCookie(request)
  );
}

function isAdClick(url: URL): boolean {
  return (
    ["gclid", "gbraid", "wbraid"].some((key) => url.searchParams.has(key)) ||
    url.searchParams.get("utm_medium")?.toLowerCase() === "cpc"
  );
}

function excludedUrl(url: URL): boolean {
  return (
    url.searchParams.has("bb_variant") ||
    url.searchParams.get("bb_internal") === "1" ||
    (ADS_TEST_PAGES.includes(url.pathname) && isAdClick(url))
  );
}

async function assignmentFor(
  experiment: PageExperiment,
  visitorId: string,
): Promise<Assignment> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${experiment.id}:${visitorId}`),
  );
  const bucket = new DataView(digest).getUint32(0, false) % 10000;
  let upper = 0;
  for (const variant of experiment.variants) {
    upper += variant.weight * 100;
    if (bucket < upper) return { experiment, variant: variant.key };
  }
  throw new Error(`Invalid experiment weights: ${experiment.id}`);
}

export async function enrollPageRequest(
  request: Request,
  enabled: boolean,
  registry: readonly PageExperiment[] = PAGE_EXPERIMENT_REGISTRY,
): Promise<Enrollment> {
  const excluded: Enrollment = {
    assignments: [],
    visitorId: null,
    cookie: null,
  };
  if (!enabled || !eligibleRequest(request)) return excluded;
  const url = new URL(request.url);
  const live = registry.filter(
    (entry) => entry.status === "live" && entry.pages.includes(url.pathname),
  );
  if (!live.length || !request.headers.get("accept")?.includes("text/html"))
    return excluded;
  if (url.searchParams.get("bb_internal") === "1")
    return { ...excluded, cookie: INTERNAL_COOKIE };
  if (cookieValue(request, "bb_internal") === "1") return excluded;
  const forced = url.searchParams.get("bb_variant");
  if (forced !== null) {
    const [id, variant, extra] = forced.split(":");
    const experiment = live.find((entry) => entry.id === id);
    return experiment &&
      !extra &&
      experiment.variants.some((entry) => entry.key === variant)
      ? { ...excluded, assignments: [{ experiment, variant: variant! }] }
      : excluded;
  }
  if (excludedUrl(url)) return excluded;
  const previous = cookieValue(request, "bb_xid");
  const visitorId = validVisitorId(previous)
    ? previous
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
  const holdout = live.find((entry) => entry.slot === "holdout");
  const assignments: Assignment[] = holdout
    ? [await assignmentFor(holdout, visitorId)]
    : [];
  if (!assignments.some((entry) => entry.variant === "holdout")) {
    assignments.push(
      ...(await Promise.all(
        live
          .filter((entry) => entry.slot !== "holdout")
          .map((entry) => assignmentFor(entry, visitorId)),
      )),
    );
  }
  return {
    assignments,
    visitorId,
    cookie: `bb_xid=${visitorId}; Path=/; Max-Age=7776000; Secure; HttpOnly; SameSite=Lax`,
  };
}

export function downloadVisitorId(
  request: Request,
  enabled: boolean,
): string | null {
  if (
    !enabled ||
    !eligibleRequest(request) ||
    cookieValue(request, "bb_internal") === "1"
  )
    return null;
  const url = new URL(request.url);
  if (excludedUrl(url)) return null;
  const referrer = request.headers.get("referer");
  if (referrer) {
    let source: URL;
    try {
      source = new URL(referrer);
    } catch {
      return null;
    }
    if (
      source.origin !== url.origin ||
      excludedUrl(source) ||
      (ADS_TEST_PAGES.includes(source.pathname) && isAdClick(url))
    )
      return null;
  } else if (isAdClick(url)) {
    return null;
  }
  const value = cookieValue(request, "bb_xid");
  return validVisitorId(value) ? value : null;
}

async function sendExposures(
  request: Request,
  enrollment: Enrollment,
  key: string,
): Promise<void> {
  const original = new URL(request.url);
  const current = new URL(original.pathname, original.origin);
  for (const [name, value] of original.searchParams) {
    if (name.startsWith("utm_")) current.searchParams.append(name, value);
  }
  await fetch("https://us.i.posthog.com/batch/?ip=0", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      batch: enrollment.assignments.map(({ experiment, variant }) => ({
        event: "experiment_exposed",
        distinct_id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        properties: {
          experiment_id: experiment.id,
          variant,
          slot: experiment.slot,
          page_path: original.pathname,
          visitor_analytics_id: enrollment.visitorId,
          $current_url: current.href,
          $process_person_profile: false,
        },
      })),
    }),
  }).catch(() => {});
}

export function finishPageRequest(
  request: Request,
  response: Response,
  enrollment: Enrollment,
  key: string | undefined,
  waitUntil: (promise: Promise<void>) => void,
): Response {
  if (
    response.status !== 200 ||
    response.headers.get("content-type")?.split(";")[0]?.trim() !== "text/html"
  )
    return response;
  if (!enrollment.cookie && !enrollment.assignments.length) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  if (enrollment.cookie) headers.append("Set-Cookie", enrollment.cookie);
  if (key && enrollment.visitorId)
    waitUntil(sendExposures(request, enrollment, key));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
