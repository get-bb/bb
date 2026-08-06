import { describe, expect, it, vi } from "vitest";
import {
  createWorkTogetherMembershipDatabaseSessionAdapter,
  WORK_TOGETHER_MEMBERSHIP_BEGIN,
  WORK_TOGETHER_MEMBERSHIP_COMMIT,
  WORK_TOGETHER_MEMBERSHIP_QUERY,
  WORK_TOGETHER_MEMBERSHIP_ROLLBACK,
  WORK_TOGETHER_MEMBERSHIP_SET_ROLE,
  type WorkTogetherMembershipSqlClient,
  type WorkTogetherMembershipSqlPool,
} from "../../src/auth/work-together-membership-database-session.js";
import {
  WorkTogetherMembershipInvalidLookupError,
  WorkTogetherMembershipLookupError,
} from "../../src/auth/work-together-membership.js";

const CELL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SUBJECT = "user_2abcDEF0123456789";
const LARGE_REVISION = "9007199254740993"; // > Number.MAX_SAFE_INTEGER

type QueryCall = {
  text: string;
  values: readonly unknown[] | undefined;
};

function createRecordingPool(options: {
  rows?: readonly unknown[];
  failAt?: "connect" | "begin" | "set_role" | "select" | "commit" | "rollback";
  selectRows?: readonly unknown[];
}): {
  pool: WorkTogetherMembershipSqlPool;
  calls: QueryCall[];
  release: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
} {
  const calls: QueryCall[] = [];
  const release = vi.fn();
  let selectCount = 0;

  const client: WorkTogetherMembershipSqlClient = {
    async query(text, values) {
      calls.push({ text, values });
      if (
        options.failAt === "begin" &&
        text === WORK_TOGETHER_MEMBERSHIP_BEGIN
      ) {
        throw new Error(`db explode begin ${SUBJECT} ${CELL_ID}`);
      }
      if (
        options.failAt === "set_role" &&
        text === WORK_TOGETHER_MEMBERSHIP_SET_ROLE
      ) {
        throw new Error(`db explode set role ${SUBJECT}`);
      }
      if (
        options.failAt === "select" &&
        text === WORK_TOGETHER_MEMBERSHIP_QUERY
      ) {
        throw new Error(`db explode select ${SUBJECT} ${CELL_ID}`);
      }
      if (
        options.failAt === "commit" &&
        text === WORK_TOGETHER_MEMBERSHIP_COMMIT
      ) {
        throw new Error(`db explode commit ${SUBJECT}`);
      }
      if (
        options.failAt === "rollback" &&
        text === WORK_TOGETHER_MEMBERSHIP_ROLLBACK
      ) {
        throw new Error(`db explode rollback ${SUBJECT}`);
      }
      if (text === WORK_TOGETHER_MEMBERSHIP_QUERY) {
        selectCount += 1;
        return {
          rows: options.selectRows ?? options.rows ?? [],
        };
      }
      return { rows: [] };
    },
    release,
  };

  const connect = vi.fn(async () => {
    if (options.failAt === "connect") {
      throw new Error(`pool connect failed for ${SUBJECT} ${CELL_ID}`);
    }
    return client;
  });

  return {
    pool: { connect },
    calls,
    release,
    connect,
  };
}

describe("work-together membership database-session adapter", () => {
  it("validates cellId and subject before opening a client", async () => {
    const { pool, connect } = createRecordingPool({ rows: [] });
    const adapter = createWorkTogetherMembershipDatabaseSessionAdapter(pool);

    await expect(
      adapter.currentMembership({
        cellId: "NOT-A-UUID",
        subject: SUBJECT,
      }),
    ).rejects.toBeInstanceOf(WorkTogetherMembershipInvalidLookupError);

    await expect(
      adapter.currentMembership({
        cellId: CELL_ID,
        subject: "not_a_clerk_subject",
      }),
    ).rejects.toBeInstanceOf(WorkTogetherMembershipInvalidLookupError);

    await expect(
      adapter.currentMembership({
        cellId: CELL_ID.toUpperCase(),
        subject: SUBJECT,
      }),
    ).rejects.toBeInstanceOf(WorkTogetherMembershipInvalidLookupError);

    await expect(
      adapter.currentMembership({
        cellId: CELL_ID,
        subject: `user_${"a".repeat(129)}`,
      }),
    ).rejects.toBeInstanceOf(WorkTogetherMembershipInvalidLookupError);

    expect(connect).not.toHaveBeenCalled();
  });

  it("does not echo subject or cellId in invalid-input errors", async () => {
    const { pool } = createRecordingPool({ rows: [] });
    const adapter = createWorkTogetherMembershipDatabaseSessionAdapter(pool);
    const badSubject = "user_leakedSubjectValueXYZ";

    await expect(
      adapter.currentMembership({
        cellId: "bad-cell-id-value",
        subject: badSubject,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(WorkTogetherMembershipInvalidLookupError);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("bad-cell-id-value");
      expect(message).not.toContain(badSubject);
      expect(message).not.toContain(CELL_ID);
      expect(message).not.toContain(SUBJECT);
      return true;
    });
  });

  it("runs BEGIN READ ONLY, static SET LOCAL ROLE, parameterized query, then COMMIT", async () => {
    const membership = {
      role: "owner",
      membership_revision: "1",
    };
    const { pool, calls, release } = createRecordingPool({
      rows: [membership],
    });
    const adapter = createWorkTogetherMembershipDatabaseSessionAdapter(pool);

    const result = await adapter.currentMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
    });

    expect(result).toEqual({ role: "owner", membershipRevision: "1" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(calls.map((call) => call.text)).toEqual([
      WORK_TOGETHER_MEMBERSHIP_BEGIN,
      WORK_TOGETHER_MEMBERSHIP_SET_ROLE,
      WORK_TOGETHER_MEMBERSHIP_QUERY,
      WORK_TOGETHER_MEMBERSHIP_COMMIT,
    ]);
    expect(calls[2]?.values).toEqual([CELL_ID, SUBJECT]);
    expect(calls[0]?.values).toBeUndefined();
    expect(calls[1]?.values).toBeUndefined();
    expect(WORK_TOGETHER_MEMBERSHIP_SET_ROLE).toBe(
      "SET LOCAL ROLE work_together_bb_cell",
    );
    expect(WORK_TOGETHER_MEMBERSHIP_QUERY).toContain(
      "work_together.bb_cell_membership($1::uuid, $2::text)",
    );
    expect(WORK_TOGETHER_MEMBERSHIP_QUERY).not.toMatch(/workspace/i);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("returns null for zero rows and still commits", async () => {
    const { pool, calls, release } = createRecordingPool({ rows: [] });
    const adapter = createWorkTogetherMembershipDatabaseSessionAdapter(pool);

    await expect(
      adapter.currentMembership({ cellId: CELL_ID, subject: SUBJECT }),
    ).resolves.toBeNull();

    expect(calls.map((call) => call.text)).toEqual([
      WORK_TOGETHER_MEMBERSHIP_BEGIN,
      WORK_TOGETHER_MEMBERSHIP_SET_ROLE,
      WORK_TOGETHER_MEMBERSHIP_QUERY,
      WORK_TOGETHER_MEMBERSHIP_COMMIT,
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("preserves bigint revisions above JS safe integer exactly", async () => {
    const { pool } = createRecordingPool({
      rows: [{ role: "member", membership_revision: LARGE_REVISION }],
    });
    const adapter = createWorkTogetherMembershipDatabaseSessionAdapter(pool);

    const result = await adapter.currentMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
    });

    expect(result).toEqual({
      role: "member",
      membershipRevision: LARGE_REVISION,
    });
    expect(result?.membershipRevision).toBe(LARGE_REVISION);
    expect(Number.isSafeInteger(Number(LARGE_REVISION))).toBe(false);
  });

  it("rejects revisions above PostgreSQL bigint max", async () => {
    const tooLarge = "9223372036854775808";
    const { pool, calls, release } = createRecordingPool({
      rows: [{ role: "owner", membership_revision: tooLarge }],
    });
    const adapter = createWorkTogetherMembershipDatabaseSessionAdapter(pool);

    await expect(
      adapter.currentMembership({ cellId: CELL_ID, subject: SUBJECT }),
    ).rejects.toBeInstanceOf(WorkTogetherMembershipLookupError);

    expect(calls.map((call) => call.text)).toEqual([
      WORK_TOGETHER_MEMBERSHIP_BEGIN,
      WORK_TOGETHER_MEMBERSHIP_SET_ROLE,
      WORK_TOGETHER_MEMBERSHIP_QUERY,
      WORK_TOGETHER_MEMBERSHIP_ROLLBACK,
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("fail-closes on multiple rows with rollback and release", async () => {
    const { pool, calls, release } = createRecordingPool({
      rows: [
        { role: "owner", membership_revision: "1" },
        { role: "member", membership_revision: "2" },
      ],
    });
    const adapter = createWorkTogetherMembershipDatabaseSessionAdapter(pool);

    await expect(
      adapter.currentMembership({ cellId: CELL_ID, subject: SUBJECT }),
    ).rejects.toBeInstanceOf(WorkTogetherMembershipLookupError);

    expect(calls.map((call) => call.text)).toContain(
      WORK_TOGETHER_MEMBERSHIP_ROLLBACK,
    );
    expect(calls.map((call) => call.text)).not.toContain(
      WORK_TOGETHER_MEMBERSHIP_COMMIT,
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "missing role",
      row: { membership_revision: "1" },
    },
    {
      name: "missing revision",
      row: { role: "owner" },
    },
    {
      name: "unknown role",
      row: { role: "admin", membership_revision: "1" },
    },
    {
      name: "leading-zero revision",
      row: { role: "owner", membership_revision: "01" },
    },
    {
      name: "zero revision",
      row: { role: "owner", membership_revision: "0" },
    },
    {
      name: "numeric revision",
      row: { role: "owner", membership_revision: 1 },
    },
    {
      name: "unknown field",
      row: { role: "owner", membership_revision: "1", workspace_id: "x" },
    },
    {
      name: "null row",
      row: null,
    },
  ])("fail-closes on strict row parse failure: $name", async ({ row }) => {
    const { pool, calls, release } = createRecordingPool({
      rows: [row],
    });
    const adapter = createWorkTogetherMembershipDatabaseSessionAdapter(pool);

    await expect(
      adapter.currentMembership({ cellId: CELL_ID, subject: SUBJECT }),
    ).rejects.toBeInstanceOf(WorkTogetherMembershipLookupError);

    expect(calls.map((call) => call.text)).toEqual([
      WORK_TOGETHER_MEMBERSHIP_BEGIN,
      WORK_TOGETHER_MEMBERSHIP_SET_ROLE,
      WORK_TOGETHER_MEMBERSHIP_QUERY,
      WORK_TOGETHER_MEMBERSHIP_ROLLBACK,
    ]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(["connect", "begin", "set_role", "select", "commit"] as const)(
    "rolls back when needed, releases, and returns generic error on %s failure",
    async (failAt) => {
      const { pool, calls, release, connect } = createRecordingPool({
        rows: [{ role: "owner", membership_revision: "1" }],
        failAt,
      });
      const adapter = createWorkTogetherMembershipDatabaseSessionAdapter(pool);

      await expect(
        adapter.currentMembership({ cellId: CELL_ID, subject: SUBJECT }),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(WorkTogetherMembershipLookupError);
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(SUBJECT);
        expect(message).not.toContain(CELL_ID);
        expect(message).not.toContain("explode");
        expect(message).not.toMatch(/user_/);
        return true;
      });

      if (failAt === "connect") {
        expect(connect).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
      } else {
        expect(release).toHaveBeenCalledTimes(1);
        expect(calls.map((call) => call.text)).toContain(
          WORK_TOGETHER_MEMBERSHIP_ROLLBACK,
        );
        if (failAt !== "commit") {
          expect(calls.map((call) => call.text)).not.toContain(
            WORK_TOGETHER_MEMBERSHIP_COMMIT,
          );
        }
      }
    },
  );

  it("still releases when rollback itself fails", async () => {
    const calls: QueryCall[] = [];
    const customRelease = vi.fn();
    const client: WorkTogetherMembershipSqlClient = {
      async query(text, values) {
        calls.push({ text, values });
        if (text === WORK_TOGETHER_MEMBERSHIP_QUERY) {
          throw new Error(`select failed ${SUBJECT}`);
        }
        if (text === WORK_TOGETHER_MEMBERSHIP_ROLLBACK) {
          throw new Error(`rollback failed ${SUBJECT}`);
        }
        return { rows: [] };
      },
      release: customRelease,
    };
    const adapter = createWorkTogetherMembershipDatabaseSessionAdapter({
      connect: async () => client,
    });

    await expect(
      adapter.currentMembership({ cellId: CELL_ID, subject: SUBJECT }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(WorkTogetherMembershipLookupError);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(SUBJECT);
      expect(message).not.toContain("select failed");
      expect(message).not.toContain("rollback failed");
      return true;
    });

    expect(customRelease).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.text)).toEqual([
      WORK_TOGETHER_MEMBERSHIP_BEGIN,
      WORK_TOGETHER_MEMBERSHIP_SET_ROLE,
      WORK_TOGETHER_MEMBERSHIP_QUERY,
      WORK_TOGETHER_MEMBERSHIP_ROLLBACK,
    ]);
  });
});
