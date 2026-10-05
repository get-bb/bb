const PALETTE_THREAD_VISITS_KEY = "bb.palette.visits";
const PALETTE_THREAD_VISITS_LIMIT = 100;

export function readPaletteThreadVisits(): string[] {
  try {
    const stored = window.localStorage.getItem(PALETTE_THREAD_VISITS_KEY);
    if (stored === null) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter((entry): entry is string => typeof entry === "string"),
      ),
    ].slice(0, PALETTE_THREAD_VISITS_LIMIT);
  } catch {
    return [];
  }
}

export function recordPaletteThreadVisit(threadId: string): void {
  const next = [
    threadId,
    ...readPaletteThreadVisits().filter((entry) => entry !== threadId),
  ].slice(0, PALETTE_THREAD_VISITS_LIMIT);
  try {
    window.localStorage.setItem(
      PALETTE_THREAD_VISITS_KEY,
      JSON.stringify(next),
    );
  } catch {}
}
