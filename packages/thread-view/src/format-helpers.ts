import type { JsonObject } from "@bb/domain";
import { z } from "zod";

export function getMessageStartedAt(message: {
  createdAt: number;
  startedAt?: number;
}): number {
  return message.startedAt ?? message.createdAt;
}

function getNonEmptyStringField(
  record: JsonObject | null,
  key: string,
): string | undefined {
  const value = z.string().min(1).safeParse(record?.[key]);
  return value.success ? value.data : undefined;
}

export function getFirstStringField(
  record: JsonObject | null,
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
