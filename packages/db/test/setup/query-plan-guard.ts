import { afterAll } from "vitest";
import {
  formatQueryPlanViolations,
  installTestQueryPlanGuard,
} from "@bb/db/query-plan-test-guard";

const guard = installTestQueryPlanGuard({
  reportPath: process.env.BB_QUERY_PLAN_REPORT ?? null,
  executedFunctionsPath: process.env.BB_QUERY_PLAN_EXECUTED ?? null,
});

afterAll(() => {
  const violations = guard.takeViolations();
  if (violations.length > 0) {
    throw new Error(
      `Slow query plans need an index fix or an entry in packages/db/src/query-plan-allowlist.ts:\n\n${formatQueryPlanViolations(violations)}`,
    );
  }
});
