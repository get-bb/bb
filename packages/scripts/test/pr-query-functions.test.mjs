import { expect, it } from "vitest";
import { untestedChangedQueryFunctions } from "../../../scripts/lib/pr-query-functions.mjs";

it("reports only untested query functions in changed data files", () => {
  expect(
    untestedChangedQueryFunctions({
      changedFiles: [
        "packages/db/src/data/projects.ts",
        "packages/db/src/schema.ts",
      ],
      queryFunctions: [
        "packages/db/src/data/projects.ts#getProject",
        "packages/db/src/data/projects.ts#renameProject",
        "packages/db/src/data/threads.ts#getThread",
      ],
      executedRows: [
        {
          kind: "executed",
          functions: ["packages/db/src/data/projects.ts#getProject"],
        },
        {
          kind: "finding",
          caller: "packages/db/src/data/projects.ts#renameProject",
        },
      ],
    }),
  ).toEqual(["packages/db/src/data/projects.ts#renameProject"]);
});
