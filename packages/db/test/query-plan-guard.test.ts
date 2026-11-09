import { build } from "esbuild";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { DbConnection } from "../src/connection.js";
import {
  createQueryPlanAuditor,
  type QueryPlanFindingReport,
} from "../src/query-plan-guard.js";
import { createMigratedConnection } from "../src/testing.js";

type LatestEventOfTypes = (db: DbConnection, threadId: string) => unknown;

const requireOutsideVitest = createRequire(import.meta.url);

async function bundleLatestEventQuery(
  root: string,
): Promise<LatestEventOfTypes> {
  const sourceDir = join(root, "apps/demo/src");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(
    join(sourceDir, "latest-event.ts"),
    `export function latestEventOfTypes(db, threadId) {
  return db.$client
    .prepare("select id from events where thread_id = ? and type in (?, ?) order by sequence desc limit 1")
    .get(threadId, "turn/completed", "turn/failed");
}
`,
  );
  const outfile = join(root, "apps/demo/dist/index.cjs");
  await build({
    absWorkingDir: join(root, "apps/demo"),
    bundle: true,
    entryPoints: [join(sourceDir, "latest-event.ts")],
    format: "cjs",
    outfile,
    platform: "node",
  });
  const bundle: { latestEventOfTypes: LatestEventOfTypes } =
    requireOutsideVitest(outfile);
  return bundle.latestEventOfTypes;
}

describe("query plan auditor", () => {
  it.skipIf(process.platform === "win32")(
    "audits a bundled query after it returns and attributes it to its source module",
    async () => {
      const root = realpathSync(
        mkdtempSync(join(tmpdir(), "bb-query-plan-guard-")),
      );
      const auditDatabase = createMigratedConnection().$client;
      const findings: QueryPlanFindingReport[] = [];
      let queued = 0;
      const auditor = createQueryPlanAuditor({
        auditDatabase,
        bundle: {
          directory: join(root, "apps/demo/dist"),
          packagePath: "apps/demo",
        },
        onFinding: (finding) => findings.push(finding),
        onQueued: () => {
          queued += 1;
        },
      });
      const db = createMigratedConnection({ queryPlanObserver: () => auditor });
      try {
        const latestEventOfTypes = await bundleLatestEventQuery(root);

        latestEventOfTypes(db, "thr_1");
        latestEventOfTypes(db, "thr_2");
        expect(queued).toBe(1);
        expect(findings).toEqual([]);

        auditor.flush();
        expect(findings).toEqual([
          expect.objectContaining({
            rule: "weaker-index",
            table: "events",
            caller: "apps/demo/src/latest-event.ts#latestEventOfTypes",
            allowed: false,
          }),
        ]);
      } finally {
        db.$client.close();
        auditDatabase.close();
        rmSync(root, { force: true, recursive: true });
      }
    },
  );
});
