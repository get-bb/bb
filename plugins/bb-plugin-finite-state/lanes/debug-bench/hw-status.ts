import { Buffer } from "node:buffer";
import type Database from "better-sqlite3";
import type { BenchDeviceRecord, FamilyStatus } from "./registry/families.js";
import { DEFAULT_CLAIM_TTL_MS } from "./registry/claims.js";
import {
  listDevices,
  listFamilyStatuses,
  type RegistryScope,
} from "./registry/store.js";

export const HW_STATUS_MAX_PAGE_SIZE = 100;

export interface PageQuery extends RegistryScope {
  pageSize?: number;
  cursor?: string | null;
}

export type HwStatusEntry =
  | { entryType: "family"; family: FamilyStatus }
  | { entryType: "device"; device: BenchDeviceRecord };

export interface Page<Item> {
  items: Item[];
  total: number;
  cursor: string | null;
  requestedPageSize: number;
  appliedPageSize: number;
  clamped: boolean;
}

export interface HwStatusContext extends RegistryScope {
  db: Database.Database;
  now?: Date;
}

interface HwStatusCursor {
  familyOffset: number;
  deviceCursor: string | null;
}

function decodeCursor(cursor: string | null | undefined): HwStatusCursor {
  if (!cursor) return { familyOffset: 0, deviceCursor: null };
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const familyOffset = Reflect.get(value, "familyOffset");
      const deviceCursor = Reflect.get(value, "deviceCursor");
      if (
        typeof familyOffset === "number" && Number.isSafeInteger(familyOffset) &&
        familyOffset >= 0 &&
        (typeof deviceCursor === "string" || deviceCursor === null)
      ) {
        return { familyOffset, deviceCursor };
      }
    }
  } catch {
    // Converted to a stable public error below.
  }
  throw new Error("INVALID_HW_STATUS_CURSOR");
}

function encodeCursor(cursor: HwStatusCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export async function getHwStatus(
  ctx: HwStatusContext,
  q: PageQuery,
): Promise<Page<HwStatusEntry>> {
  const now = ctx.now ?? new Date();
  const activeClaimCutoff = new Date(now.getTime() - DEFAULT_CLAIM_TTL_MS).toISOString();
  const requestedPageSize = Math.max(1, Math.trunc(q.pageSize ?? 50));
  const appliedPageSize = Math.min(HW_STATUS_MAX_PAGE_SIZE, requestedPageSize);
  const families = listFamilyStatuses(ctx.db, q);
  const current = decodeCursor(q.cursor);
  const familyItems = families
    .slice(current.familyOffset, current.familyOffset + appliedPageSize)
    .map<HwStatusEntry>((family) => ({ entryType: "family", family }));
  const remaining = appliedPageSize - familyItems.length;
  const devicePage = listDevices(ctx.db, {
    ...q,
    pageSize: Math.max(1, remaining),
    cursor: current.deviceCursor,
    includeStale: true,
    activeClaimCutoff,
  });
  const deviceItems = (remaining > 0 ? devicePage.items : []).map<HwStatusEntry>((device) => ({
    entryType: "device",
    device,
  }));
  const familyOffset = current.familyOffset + familyItems.length;
  const cursor = familyOffset < families.length
    ? encodeCursor({ familyOffset, deviceCursor: current.deviceCursor })
    : remaining === 0 && devicePage.total > 0
      ? encodeCursor({ familyOffset, deviceCursor: current.deviceCursor })
    : devicePage.cursor === null
      ? null
      : encodeCursor({ familyOffset, deviceCursor: devicePage.cursor });
  return {
    items: [...familyItems, ...deviceItems],
    total: families.length + devicePage.total,
    cursor,
    requestedPageSize,
    appliedPageSize,
    clamped: appliedPageSize !== requestedPageSize,
  };
}
