import { afterAll } from "vitest";
import {
  formatQueryPlanViolations,
  installQueryPlanGuard,
} from "@bb/db/query-plan-guard";

const guard = installQueryPlanGuard({
  reportPath: process.env.BB_QUERY_PLAN_REPORT ?? null,
});

afterAll(() => {
  const violations = guard.takeViolations();
  if (violations.length > 0) {
    throw new Error(
      `Slow query plans need an index fix or an entry in packages/db/src/query-plan-allowlist.ts:\n\n${formatQueryPlanViolations(violations)}`,
    );
  }
});
