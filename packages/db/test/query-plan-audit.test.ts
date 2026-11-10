import { describe, expect, it } from "vitest";
import {
  auditQueryPlan,
  type QueryPlanParameter,
} from "../src/query-plan-audit.js";
import { createMigratedConnection } from "../src/testing.js";

const LARGE_TABLES = new Set(["events"]);

function audit(sql: string, params: readonly QueryPlanParameter[]) {
  const db = createMigratedConnection();
  try {
    const result = auditQueryPlan(db.$client, sql, {
      largeTables: LARGE_TABLES,
      params,
    });
    if (result.status !== "audited") throw new Error(result.reason);
    return result.findings.map((finding) => `${finding.rule}:${finding.table}`);
  } finally {
    db.$client.close();
  }
}

const latestModelFallbackSql = (from: string) => `
  select "id", "data" from ${from}
  where ("events"."thread_id" = ?
    and "events"."type" in (?, ?)
    and "events"."sequence" > COALESCE((
      SELECT MAX(request.sequence) FROM events request
      WHERE request.thread_id = ? AND request.type = ?
    ), -1))
  order by "events"."sequence" desc limit ?`;
const latestModelFallbackParams = [
  "thr_1",
  "provider/modelFallback",
  "provider/unhandled",
  "thr_1",
  "client/turn/requested",
  1,
];

describe("auditQueryPlan", () => {
  it("flags an events search that walks the thread instead of seeking its type", () => {
    expect(
      audit(latestModelFallbackSql(`"events"`), latestModelFallbackParams),
    ).toContain("weaker-index:events");
    expect(
      audit(
        latestModelFallbackSql(
          `"events" INDEXED BY events_thread_type_sequence_idx`,
        ),
        latestModelFallbackParams,
      ),
    ).not.toContain("weaker-index:events");
  });

  it("plans partial-index queries with the bound values production uses", () => {
    const sql = `select "id" from "events"
      where "events"."type" = ? and "events"."provider_thread_id" = ?
      limit 1`;

    expect(audit(sql, ["thread/identity", "provider-thread"])).toEqual([]);
    expect(audit(sql, ["turn/started", "provider-thread"])).toContain(
      "full-scan:events",
    );
  });

  it("accepts a unique-key lookup without probing other indexes", () => {
    expect(
      audit(
        `select "data" from "events" where "events"."thread_id" = ? and "events"."sequence" = ? and "events"."type" = ?`,
        ["thr_1", 4, "turn/started"],
      ),
    ).toEqual([]);
  });
});
