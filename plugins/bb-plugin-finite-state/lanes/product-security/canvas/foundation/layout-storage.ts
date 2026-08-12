import type { LayoutResult } from "./types.js";

const LAYOUT_STORAGE_VERSION = 1;
const LAYOUT_STORAGE_PREFIX = "finite-state:product-security:canvas-layout";

type CanvasPositions = LayoutResult["positions"];

export interface CanvasLayoutStorage {
  read(projectId: string, nodeIds: readonly string[]): CanvasPositions | null;
  write(projectId: string, positions: CanvasPositions): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCoordinate(value: unknown, key: "x" | "y"): number | null {
  if (!isRecord(value)) return null;
  const coordinate = value[key];
  return typeof coordinate === "number" && Number.isFinite(coordinate)
    ? coordinate
    : null;
}

export function canvasLayoutStorageKey(projectId: string): string {
  return `${LAYOUT_STORAGE_PREFIX}:v${LAYOUT_STORAGE_VERSION}:${encodeURIComponent(projectId)}`;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const browserCanvasLayoutStorage: CanvasLayoutStorage = {
  read(projectId, nodeIds) {
    const storage = browserStorage();
    if (!storage) return null;

    let decoded: unknown;
    try {
      const serialized = storage.getItem(canvasLayoutStorageKey(projectId));
      if (!serialized) return null;
      decoded = JSON.parse(serialized);
    } catch {
      return null;
    }
    if (
      !isRecord(decoded) ||
      decoded.version !== LAYOUT_STORAGE_VERSION ||
      !isRecord(decoded.positions)
    ) {
      return null;
    }

    const allowedIds = new Set(nodeIds);
    const positions: CanvasPositions = {};
    for (const [id, value] of Object.entries(decoded.positions)) {
      if (!allowedIds.has(id)) continue;
      const x = readCoordinate(value, "x");
      const y = readCoordinate(value, "y");
      if (x !== null && y !== null) positions[id] = { x, y };
    }
    return positions;
  },

  write(projectId, positions) {
    const storage = browserStorage();
    if (!storage) return;

    const normalized: CanvasPositions = {};
    for (const id of Object.keys(positions).sort()) {
      const position = positions[id];
      if (!position) continue;
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
        continue;
      }
      normalized[id] = {
        x: Math.round(position.x),
        y: Math.round(position.y),
      };
    }
    try {
      storage.setItem(
        canvasLayoutStorageKey(projectId),
        JSON.stringify({
          version: LAYOUT_STORAGE_VERSION,
          positions: normalized,
        }),
      );
    } catch {
      // A private or quota-limited browser may decline persistence. The
      // successful in-memory layout remains usable for this panel session.
    }
  },
};
