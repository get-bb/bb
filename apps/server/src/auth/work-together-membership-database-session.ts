import {
  assertWorkTogetherMembershipLookup,
  parseWorkTogetherMembershipRow,
  WorkTogetherMembershipLookupError,
  type WorkTogetherMembership,
  type WorkTogetherMembershipLookup,
  type WorkTogetherMembershipVerifier,
} from "./work-together-membership.js";

/**
 * Minimal structural PostgreSQL client surface used by the membership adapter.
 * Intentionally not typed against `pg` so this slice has no driver dependency.
 */
export interface WorkTogetherMembershipSqlClient {
  query(
    queryText: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
  release(): void;
}

export interface WorkTogetherMembershipSqlPool {
  connect(): Promise<WorkTogetherMembershipSqlClient>;
}

export const WORK_TOGETHER_MEMBERSHIP_BEGIN = "BEGIN READ ONLY";
export const WORK_TOGETHER_MEMBERSHIP_SET_ROLE =
  "SET LOCAL ROLE work_together_bb_cell";
export const WORK_TOGETHER_MEMBERSHIP_QUERY =
  "SELECT role, membership_revision::text AS membership_revision FROM work_together.bb_cell_membership($1::uuid, $2::text)";
export const WORK_TOGETHER_MEMBERSHIP_COMMIT = "COMMIT";
export const WORK_TOGETHER_MEMBERSHIP_ROLLBACK = "ROLLBACK";

/**
 * Database-session adapter: opens a pooled client, elevates to the cell
 * capability role for the transaction only, and calls the security-definer
 * membership function. Never accepts a workspace argument.
 */
export function createWorkTogetherMembershipDatabaseSessionAdapter(
  pool: WorkTogetherMembershipSqlPool,
): WorkTogetherMembershipVerifier {
  return {
    async currentMembership(
      args: WorkTogetherMembershipLookup,
    ): Promise<WorkTogetherMembership | null> {
      assertWorkTogetherMembershipLookup(args);

      let client: WorkTogetherMembershipSqlClient;
      try {
        client = await pool.connect();
      } catch {
        throw new WorkTogetherMembershipLookupError();
      }

      try {
        await client.query(WORK_TOGETHER_MEMBERSHIP_BEGIN);
        await client.query(WORK_TOGETHER_MEMBERSHIP_SET_ROLE);
        const result = await client.query(WORK_TOGETHER_MEMBERSHIP_QUERY, [
          args.cellId,
          args.subject,
        ]);
        const membership = parseQueryRows(result.rows);
        await client.query(WORK_TOGETHER_MEMBERSHIP_COMMIT);
        return membership;
      } catch (error) {
        await bestEffortRollback(client);
        if (error instanceof WorkTogetherMembershipLookupError) {
          throw error;
        }
        throw new WorkTogetherMembershipLookupError();
      } finally {
        try {
          client.release();
        } catch {
          // Always attempt release; ignore secondary failures.
        }
      }
    },
  };
}

function parseQueryRows(
  rows: readonly unknown[],
): WorkTogetherMembership | null {
  if (!Array.isArray(rows)) {
    throw new WorkTogetherMembershipLookupError();
  }
  if (rows.length === 0) {
    return null;
  }
  if (rows.length !== 1) {
    throw new WorkTogetherMembershipLookupError();
  }
  return parseWorkTogetherMembershipRow(rows[0]);
}

async function bestEffortRollback(
  client: WorkTogetherMembershipSqlClient,
): Promise<void> {
  try {
    await client.query(WORK_TOGETHER_MEMBERSHIP_ROLLBACK);
  } catch {
    // best-effort
  }
}
