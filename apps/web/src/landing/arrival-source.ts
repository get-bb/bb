export type ArrivalSource = "share" | "search" | "social" | "direct" | "other";

const GOOGLE_HOST = /(^|\.)google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

const SEARCH_DOMAINS = ["bing.com", "duckduckgo.com"];

const SOCIAL_DOMAINS = [
  "x.com",
  "twitter.com",
  "t.co",
  "reddit.com",
  "discord.com",
  "discord.gg",
  "discordapp.com",
  "linkedin.com",
  "lnkd.in",
  "news.ycombinator.com",
  "youtube.com",
  "youtu.be",
];

function matchesDomain(host: string, domains: readonly string[]): boolean {
  return domains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

function referrerHost(referrer: string): string | null {
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function classifyArrivalSource(
  searchParams: URLSearchParams,
  referrer: string,
): ArrivalSource {
  if (searchParams.get("utm_medium")?.trim().toLowerCase() === "share") {
    return "share";
  }
  if (referrer.trim() === "") {
    return "direct";
  }
  const host = referrerHost(referrer);
  if (host === null || host === "") {
    return "other";
  }
  if (GOOGLE_HOST.test(host) || matchesDomain(host, SEARCH_DOMAINS)) {
    return "search";
  }
  if (matchesDomain(host, SOCIAL_DOMAINS)) {
    return "social";
  }
  return "other";
}
