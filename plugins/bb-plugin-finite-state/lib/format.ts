export type Severity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "none"
  | "unknown";

const EMPTY_VALUE = "—";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u;
const HEX_HASH = /^[a-f\d]+$/iu;
const PURL =
  /^pkg:[a-z][a-z\d.+-]*\/[^\s\u0000-\u001f\u007f/?#][^\s\u0000-\u001f\u007f]*$/u;

const SEVERITIES = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
} as const satisfies Record<Exclude<Severity, "unknown">, string>;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function parseIsoInstant(value: string | null | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!ISO_DATE.test(normalized) && !ISO_INSTANT.test(normalized)) {
    return null;
  }

  const timestamp = Date.parse(
    ISO_DATE.test(normalized) ? `${normalized}T00:00:00.000Z` : normalized,
  );
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  // Date.parse normalizes impossible calendar values in some runtimes. The
  // round trip keeps date-only input strict and deterministic.
  if (ISO_DATE.test(normalized) && new Date(timestamp).toISOString().slice(0, 10) !== normalized) {
    return null;
  }

  return timestamp;
}

function compactDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/u, "");
}

export function formatSeverity(
  value: string | null | undefined,
): { label: string; severity: Severity } {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "critical":
    case "high":
    case "medium":
    case "low":
    case "none":
      return { label: SEVERITIES[normalized], severity: normalized };
    default:
      return { label: "Unknown", severity: "unknown" };
  }
}

export function formatCvss(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10
    ? value.toFixed(1)
    : EMPTY_VALUE;
}

export function formatEpss(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? `${(value * 100).toFixed(1)}%`
    : EMPTY_VALUE;
}

export function formatIsoDate(value: string | null | undefined): string {
  const timestamp = parseIsoInstant(value);
  return timestamp === null ? EMPTY_VALUE : new Date(timestamp).toISOString().slice(0, 10);
}

export function formatRelativeDate(
  value: string | null | undefined,
  now: Date,
): string {
  const timestamp = parseIsoInstant(value);
  const nowTimestamp = now.getTime();
  if (timestamp === null || !Number.isFinite(nowTimestamp)) {
    return EMPTY_VALUE;
  }

  const difference = nowTimestamp - timestamp;
  if (difference < MINUTE_MS) {
    // Future values collapse to "just now" so clock skew cannot produce a
    // misleading negative duration.
    return "just now";
  }
  if (difference < HOUR_MS) {
    return `${Math.floor(difference / MINUTE_MS)}m ago`;
  }
  if (difference < DAY_MS) {
    return `${Math.floor(difference / HOUR_MS)}h ago`;
  }
  if (difference < WEEK_MS) {
    return `${Math.floor(difference / DAY_MS)}d ago`;
  }
  if (difference < 5 * WEEK_MS) {
    return `${Math.floor(difference / WEEK_MS)}w ago`;
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function formatHash(
  value: string | null | undefined,
  visible = 12,
): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    !HEX_HASH.test(normalized) ||
    !Number.isInteger(visible) ||
    visible < 1
  ) {
    return EMPTY_VALUE;
  }
  return normalized.length > visible ? `${normalized.slice(0, visible)}…` : normalized;
}

export function formatPurl(
  value: string | null | undefined,
  max = 72,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!PURL.test(normalized) || !Number.isInteger(max) || max < 8) {
    return EMPTY_VALUE;
  }
  if (normalized.length <= max) {
    return normalized;
  }

  const remaining = max - 1;
  const head = Math.ceil((remaining * 2) / 3);
  return `${normalized.slice(0, head)}…${normalized.slice(-(remaining - head))}`;
}

export function formatBytes(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return EMPTY_VALUE;
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;
  let scaled = value;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  const amount = unitIndex === 0 ? Math.round(scaled).toString() : compactDecimal(scaled);
  return `${amount} ${units[unitIndex]}`;
}

export function formatCount(value: number | null | undefined): string {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    return EMPTY_VALUE;
  }
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}
