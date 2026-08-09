/** Get the effective start time of a message, falling back to createdAt. */
export function getMessageStartedAt(message: {
  createdAt: number;
  startedAt?: number;
}): number {
  return message.startedAt ?? message.createdAt;
}

function getNonEmptyStringField(
  record: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function getFirstStringField(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = getNonEmptyStringField(record, key);
    if (value) return value;
  }
  return undefined;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function plural(
  count: number,
  singular: string,
  pluralName?: string,
): string {
  return `${count} ${count === 1 ? singular : (pluralName ?? `${singular}s`)}`;
}

export function durationToCompactString(durationMs: number): string;
export function durationToCompactString(durationMs: undefined): undefined;
export function durationToCompactString(
  durationMs: number | undefined,
): string | undefined {
  if (durationMs === undefined) return undefined;
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0s";
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return formatRoundedDurationSeconds(totalSeconds);
}

function formatRoundedDurationSeconds(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}

export function messageId(threadId: string, kind: string, key: string): string {
  return `${threadId}:${kind}:${key}`;
}

const DIFF_COUNT_FORMATTER = new Intl.NumberFormat("en-US");

export function formatDiffCount(value: number): string {
  return DIFF_COUNT_FORMATTER.format(value);
}

/**
 * Formats unit-suffixed diff counts with two significant digits. Values below
 * one thousand remain exact (for example, `999`, `1.1k`, or `12M`).
 */
export function formatCompactDiffCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";

  const roundedValue = Math.round(value);
  if (roundedValue < 1_000) return String(roundedValue);

  const units = [
    { divisor: 1_000_000_000_000, suffix: "T" },
    { divisor: 1_000_000_000, suffix: "B" },
    { divisor: 1_000_000, suffix: "M" },
    { divisor: 1_000, suffix: "k" },
  ] as const;
  for (const [index, { divisor, suffix }] of units.entries()) {
    if (roundedValue < divisor) continue;
    const scaled = roundedValue / divisor;
    const digitsBeforeDecimal = Math.floor(Math.log10(scaled)) + 1;
    const decimalPlaces = 2 - digitsBeforeDecimal;
    const roundingFactor = 10 ** Math.max(0, -decimalPlaces);
    const roundedScaled =
      decimalPlaces < 0
        ? Math.round(scaled / roundingFactor) * roundingFactor
        : Number(scaled.toFixed(decimalPlaces));
    if (roundedScaled >= 1_000 && index > 0) {
      return `1${units[index - 1]!.suffix}`;
    }
    const formattedScaled =
      decimalPlaces < 0
        ? String(roundedScaled)
        : roundedScaled.toFixed(decimalPlaces).replace(/\.0+$/u, "");
    return `${formattedScaled}${suffix}`;
  }

  return String(roundedValue);
}

/**
 * Renders an added/removed line tally as plain text (e.g. `+1,000 -42`).
 * With `hideZero`, sides equal to 0 are dropped — `{ added: 0, removed: 2 }`
 * becomes `"-2"` and `{ added: 0, removed: 0 }` becomes `""`.
 */
export function formatDiffStatsText(input: {
  added: number;
  removed: number;
  hideZero?: boolean;
}): string {
  const { added, removed, hideZero = false } = input;
  const addedText = `+${formatDiffCount(added)}`;
  const removedText = `-${formatDiffCount(removed)}`;
  if (!hideZero) return `${addedText} ${removedText}`;
  const parts: string[] = [];
  if (added > 0) parts.push(addedText);
  if (removed > 0) parts.push(removedText);
  return parts.join(" ");
}
