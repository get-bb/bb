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
      boundedKeyColumns: new Map([["events", new Set(["turn_id"])]]),
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

  it("flags a correlated subquery that re-searches events for each outer row", () => {
    const acceptedFilter = `accepted.thread_id = ? and accepted.type = ?`;
    const chainFilter = `request.thread_id = ? and request.type = ?
      and (json_extract(request.data, '$.requestId') = ?
        or json_extract(request.data, '$.retryOfRequestId') = ?)`;
    const params = [
      "thr_1",
      "turn/input/accepted",
      "thr_1",
      "client/turn/requested",
      "req_1",
      "req_1",
      1,
    ];

    expect(
      audit(
        `select accepted.sequence from events accepted
        where ${acceptedFilter} and exists (
          select request.sequence from events request
          where ${chainFilter}
            and json_extract(request.data, '$.requestId') = json_extract(accepted.data, '$.clientRequestId'))
        limit ?`,
        params,
      ),
    ).toEqual(["correlated-subquery:events"]);
    expect(
      audit(
        `select accepted.sequence from events accepted
        where ${acceptedFilter} and json_extract(accepted.data, '$.clientRequestId') in (
          select json_extract(request.data, '$.requestId') from events request
          where ${chainFilter})
        limit ?`,
        params,
      ),
    ).toEqual([]);
  });

  it("accepts correlated lookups whose key does not grow with history", () => {
    expect(
      audit(
        `select accepted.sequence from events accepted
        where accepted.thread_id = ? and accepted.type = ? and exists (
          select 1 from events started
          where started.thread_id = accepted.thread_id
            and started.sequence = accepted.sequence + 1
            and started.type = ?)`,
        ["thr_1", "turn/input/accepted", "turn/started"],
      ),
    ).toEqual([]);
    expect(
      audit(
        `select started.sequence from events started
        where started.thread_id = ? and started.type = ? and not exists (
          select 1 from events completed
          where completed.thread_id = started.thread_id
            and completed.turn_id = started.turn_id
            and completed.type = ?)`,
        ["thr_1", "turn/started", "turn/completed"],
      ),
    ).not.toContain("correlated-subquery:events");
  });
});
