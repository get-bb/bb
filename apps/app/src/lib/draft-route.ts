import { draftIdSchema } from "@bb/server-contract";

export function getDraftRoutePath(draftId: string): string {
  return `/?draft=${encodeURIComponent(draftId)}`;
}

export function parseDraftRouteId(search: string): string | null {
  const result = draftIdSchema.safeParse(
    new URLSearchParams(search).get("draft"),
  );
  return result.success ? result.data : null;
}
