const PALETTE_VISITS_KEY = "bb.palette.visits";
export const PALETTE_VISITS_LIMIT = 100;

const PALETTE_VISIT_KINDS = [
  "thread",
  "project",
  "section",
  "pinned",
  "page",
  "setting",
] as const;

export type PaletteVisitKind = (typeof PALETTE_VISIT_KINDS)[number];

export interface PaletteVisit {
  kind: PaletteVisitKind;
  id: string;
  visitedAt: number;
}

function isPaletteVisitKind(value: unknown): value is PaletteVisitKind {
  return PALETTE_VISIT_KINDS.some((kind) => kind === value);
}

function parsePaletteVisit(value: unknown): PaletteVisit | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("kind" in value) ||
    !("id" in value) ||
    !("visitedAt" in value)
  ) {
    return null;
  }
  const { kind, id, visitedAt } = value;
  if (
    !isPaletteVisitKind(kind) ||
    typeof id !== "string" ||
    id.length === 0 ||
    typeof visitedAt !== "number" ||
    !Number.isFinite(visitedAt)
  ) {
    return null;
  }
  return { kind, id, visitedAt };
}

function readStoredEntries(): unknown[] {
  try {
    const stored = window.localStorage.getItem(PALETTE_VISITS_KEY);
    if (stored === null) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readPaletteVisits(): PaletteVisit[] {
  const seen = new Set<string>();
  const visits: PaletteVisit[] = [];
  for (const entry of readStoredEntries()) {
    const visit = parsePaletteVisit(entry);
    if (visit === null) continue;
    const key = `${visit.kind}\u0000${visit.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    visits.push(visit);
  }
  return visits.slice(0, PALETTE_VISITS_LIMIT);
}

export function recordPaletteVisit(
  kind: PaletteVisitKind,
  id: string,
  visitedAt: number = Date.now(),
): void {
  const retained = readStoredEntries().filter((entry) => {
    const visit = parsePaletteVisit(entry);
    return visit === null || visit.kind !== kind || visit.id !== id;
  });
  const next: unknown[] = [{ kind, id, visitedAt }, ...retained].slice(
    0,
    PALETTE_VISITS_LIMIT,
  );
  try {
    window.localStorage.setItem(PALETTE_VISITS_KEY, JSON.stringify(next));
  } catch {}
}
