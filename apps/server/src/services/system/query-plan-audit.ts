import {
  createQueryPlanAuditor,
  openQueryPlanAuditDatabase,
  type QueryPlanAuditor,
  type QueryPlanExecutionObserver,
} from "@bb/db";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerLogger } from "../../types.js";

const MAX_LOGGED_SQL_LENGTH = 1_000;
const SERVER_BUNDLE = {
  directory: dirname(fileURLToPath(import.meta.url)),
  packagePath: "apps/server",
};

interface ActiveQueryPlanAudit {
  auditor: QueryPlanAuditor;
  close: () => void;
}

export function createGatedQueryPlanObserver(options: {
  databasePath: string;
  enabled: () => boolean;
  logger: Pick<ServerLogger, "warn">;
}): () => QueryPlanExecutionObserver | null {
  let active: ActiveQueryPlanAudit | null = null;
  let failed = false;
  const logged = new Set<string>();

  const stop = () => {
    active?.close();
    active = null;
  };
  const fail = (error: unknown) => {
    failed = true;
    stop();
    options.logger.warn({ err: error }, "SQLite query plan audit stopped");
  };

  const start = (): ActiveQueryPlanAudit => {
    const database = openQueryPlanAuditDatabase(options.databasePath);
    const auditor = createQueryPlanAuditor({
      auditDatabase: database,
      bundle: SERVER_BUNDLE,
      onFinding(finding) {
        if (finding.allowed) return;
        const key = `${finding.rule}\u0000${finding.table}\u0000${finding.caller}`;
        if (logged.has(key)) return;
        logged.add(key);
        options.logger.warn(
          {
            rule: finding.rule,
            table: finding.table,
            caller: finding.caller,
            detail: finding.detail,
            plan: finding.plan,
            sql: finding.sql.replace(/\s+/g, " ").slice(0, MAX_LOGGED_SQL_LENGTH),
          },
          "Slow SQLite query plan",
        );
      },
      onQueued() {
        setImmediate(() => {
          if (active?.auditor !== auditor) return;
          try {
            auditor.flush();
          } catch (error) {
            fail(error);
          }
        });
      },
    });
    return { auditor, close: () => database.close() };
  };

  return () => {
    if (failed || !options.enabled()) {
      stop();
      return null;
    }
    if (active === null) {
      try {
        active = start();
      } catch (error) {
        fail(error);
        return null;
      }
    }
    return active.auditor;
  };
}
