import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Json } from "../../../lib/remote/types.js";
import type { MockHandler, MockHandlerContext } from "../types.js";

function checks(fixtureRoot: string): Record<string, Json>[] {
  return readFileSync(resolve(fixtureRoot, "assurance-studio/verification-checks.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, Json>);
}

function page(context: MockHandlerContext, items: Record<string, Json>[]): Response {
  const query = new URL(context.request.url).searchParams;
  const pageNumber = Number(query.get("page") ?? "1");
  const limit = Number(query.get("limit") ?? "50");
  let filtered = items.filter((item) => item.projectId === context.params.projectId);
  for (const [queryKey, itemKey] of [["status", "status"], ["type", "type"], ["requirement_id", "requirementId"]] as const) {
    const value = query.get(queryKey);
    if (value !== null) filtered = filtered.filter((item) => item[itemKey] === value);
  }
  const start = (pageNumber - 1) * limit;
  const selected = filtered.slice(start, start + limit);
  return Response.json({ data: {
    checks: selected,
    total: filtered.length,
    hasMore: start + selected.length < filtered.length,
  } });
}

export function verificationListHandler(fixtureRoot: string): MockHandler {
  const seeded = checks(fixtureRoot);
  return (context) => page(context, seeded);
}

export function verificationGetHandler(fixtureRoot: string): MockHandler {
  const seeded = checks(fixtureRoot);
  return (context) => {
    const check = seeded.find((item) =>
      item.projectId === context.params.projectId && item.id === context.params.checkId,
    );
    return check === undefined
      ? Response.json({ error: { code: "AS_VERIFICATION_CHECK_NOT_FOUND" } }, { status: 404 })
      : Response.json({ data: check });
  };
}

export function verificationRunHandler(fixtureRoot: string): MockHandler {
  const seeded = checks(fixtureRoot);
  let runNumber = 1;
  return async (context) => {
    const value = await context.request.json() as { check_ids?: string[]; rerun_passed?: boolean };
    const projectChecks = seeded.filter((item) => item.projectId === context.params.projectId);
    const requested = value.check_ids ?? projectChecks.map((item) => String(item.id));
    const known = new Set(projectChecks.map((item) => item.id));
    if (requested.some((id) => !known.has(id))) {
      return Response.json({ error: { code: "AS_VERIFICATION_WRITE_UNAVAILABLE" } }, { status: 404 });
    }
    const queued = projectChecks.filter((item) =>
      requested.includes(String(item.id)) && (value.rerun_passed === true || item.status !== "verified"),
    ).length;
    return Response.json({ data: {
      run_id: `mock-verification-run-${runNumber++}`,
      checks_queued: queued,
      status: "queued",
    } });
  };
}
