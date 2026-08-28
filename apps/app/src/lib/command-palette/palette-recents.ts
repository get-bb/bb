import { z } from "zod";

const PALETTE_RECENTS_KEY = "bb.palette.recents";
const PALETTE_RECENTS_LIMIT = 8;
const paletteRecentsSchema = z.array(z.string());

export function readPaletteRecents(): string[] {
  try {
    const stored = window.localStorage.getItem(PALETTE_RECENTS_KEY);
    if (stored === null) return [];
    const parsed: unknown = JSON.parse(stored);
    const result = paletteRecentsSchema.safeParse(parsed);
    return result.success ? result.data.slice(0, PALETTE_RECENTS_LIMIT) : [];
  } catch {
    return [];
  }
}

export function recordPaletteRecent(
  recents: readonly string[],
  actionId: string,
): string[] {
  const next = [
    actionId,
    ...recents.filter((entry) => entry !== actionId),
  ].slice(0, PALETTE_RECENTS_LIMIT);
  try {
    window.localStorage.setItem(PALETTE_RECENTS_KEY, JSON.stringify(next));
  } catch {}
  return next;
}
