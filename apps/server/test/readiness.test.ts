import { createConnection } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  computeReadiness,
  evaluateReadiness,
  type ReadinessDeps,
} from "../src/readiness.js";
import {
  probeWorkTogetherMembershipReachable,
  WORK_TOGETHER_MEMBERSHIP_BEGIN,
  WORK_TOGETHER_MEMBERSHIP_COMMIT,
  WORK_TOGETHER_MEMBERSHIP_PROBE,
  WORK_TOGETHER_MEMBERSHIP_ROLLBACK,
  WORK_TOGETHER_MEMBERSHIP_SET_ROLE,
  type WorkTogetherMembershipSqlClient,
  type WorkTogetherMembershipSqlPool,
} from "../src/auth/work-together-membership-database-session.js";
import { createApp } from "../src/server.js";
import { createTestAppHarness } from "./helpers/test-app.js";

type FakePoolOptions = {
  failConnect?: boolean;
  failOnQuery?: string;
};

function createFakeMembershipPool(options: FakePoolOptions = {}): {
  pool: WorkTogetherMembershipSqlPool;
  queries: string[];
  released: () => number;
} {
  const queries: string[] = [];
  let releaseCount = 0;
  const client: WorkTogetherMembershipSqlClient = {
    async query(queryText: string) {
      queries.push(queryText);
      if (
        options.failOnQuery !== undefined &&
        queryText === options.failOnQuery
      ) {
        throw new Error("probe query failed");
      }
      return { rows: [] };
    },
    release() {
      releaseCount += 1;
    },
  };
  return {
    pool: {
      async connect() {
        if (options.failConnect === true) {
          throw new Error("connect failed");
        }
        return client;
      },
    },
    queries,
    released: () => releaseCount,
  };
}

describe("computeReadiness (pure matrix)", () => {
  it("local-owner is ready when migrations are at head; membership not-applicable", () => {
    const report = computeReadiness({
      mode: "local-owner",
      sqliteMigrationsAtHead: true,
      workTogetherRuntimeComposed: false,
      membershipPortReachable: "not-applicable",
    });
    expect(report.ready).toBe(true);
    expect(report.checks.principalPolicyLoaded).toBe(true);
    expect(report.checks.membershipPortReachable).toBe("not-applicable");
  });

  it("local-owner is not ready when migrations are not at head", () => {
    const report = computeReadiness({
      mode: "local-owner",
      sqliteMigrationsAtHead: false,
      workTogetherRuntimeComposed: false,
      membershipPortReachable: "not-applicable",
    });
    expect(report.ready).toBe(false);
  });

  it("work-together is ready when composed, at head, and membership reachable", () => {
    const report = computeReadiness({
      mode: "work-together",
      sqliteMigrationsAtHead: true,
      workTogetherRuntimeComposed: true,
      membershipPortReachable: true,
    });
    expect(report.ready).toBe(true);
    expect(report.checks.principalPolicyLoaded).toBe(true);
  });

  it("work-together is not ready when the membership port is unreachable", () => {
    const report = computeReadiness({
      mode: "work-together",
      sqliteMigrationsAtHead: true,
      workTogetherRuntimeComposed: true,
      membershipPortReachable: false,
    });
    expect(report.ready).toBe(false);
    expect(report.checks.principalPolicyLoaded).toBe(true);
    expect(report.checks.membershipPortReachable).toBe(false);
  });

  it("work-together without a composed runtime reports policy not loaded", () => {
    const report = computeReadiness({
      mode: "work-together",
      sqliteMigrationsAtHead: true,
      workTogetherRuntimeComposed: false,
      membershipPortReachable: false,
    });
    expect(report.checks.principalPolicyLoaded).toBe(false);
    expect(report.ready).toBe(false);
  });

  it("work-together is not ready when migrations are not at head", () => {
    const report = computeReadiness({
      mode: "work-together",
      sqliteMigrationsAtHead: false,
      workTogetherRuntimeComposed: true,
      membershipPortReachable: true,
    });
    expect(report.ready).toBe(false);
  });
});

describe("probeWorkTogetherMembershipReachable", () => {
  it("round-trips the read-only cell-role envelope and returns true", async () => {
    const fake = createFakeMembershipPool();
    const reachable = await probeWorkTogetherMembershipReachable(fake.pool);
    expect(reachable).toBe(true);
    expect(fake.queries).toEqual([
      WORK_TOGETHER_MEMBERSHIP_BEGIN,
      WORK_TOGETHER_MEMBERSHIP_SET_ROLE,
      WORK_TOGETHER_MEMBERSHIP_PROBE,
      WORK_TOGETHER_MEMBERSHIP_COMMIT,
    ]);
    expect(fake.released()).toBe(1);
  });

  it("returns false when the pool cannot connect", async () => {
    const fake = createFakeMembershipPool({ failConnect: true });
    expect(await probeWorkTogetherMembershipReachable(fake.pool)).toBe(false);
    expect(fake.queries).toEqual([]);
  });

  it("returns false and rolls back when a query fails", async () => {
    const fake = createFakeMembershipPool({
      failOnQuery: WORK_TOGETHER_MEMBERSHIP_PROBE,
    });
    expect(await probeWorkTogetherMembershipReachable(fake.pool)).toBe(false);
    expect(fake.queries).toContain(WORK_TOGETHER_MEMBERSHIP_ROLLBACK);
    expect(fake.released()).toBe(1);
  });
});

describe("evaluateReadiness (I/O)", () => {
  it("local-owner against a migrated db is ready with membership not-applicable", async () => {
    const harness = await createTestAppHarness();
    try {
      const report = await evaluateReadiness({
        db: harness.deps.db,
        principalMode: "local-owner",
      });
      expect(report.checks.sqliteMigrationsAtHead).toBe(true);
      expect(report.checks.membershipPortReachable).toBe("not-applicable");
      expect(report.ready).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  it("is not ready when the db is unmigrated", async () => {
    const db = createConnection(":memory:");
    try {
      const report = await evaluateReadiness({
        db,
        principalMode: "local-owner",
      });
      expect(report.checks.sqliteMigrationsAtHead).toBe(false);
      expect(report.ready).toBe(false);
    } finally {
      db.$client.close();
    }
  });

  it("work-together is ready when the membership probe succeeds", async () => {
    const harness = await createTestAppHarness();
    try {
      const report = await evaluateReadiness({
        db: harness.deps.db,
        principalMode: "work-together",
        probeMembershipReachable: async () => true,
      });
      expect(report.checks.membershipPortReachable).toBe(true);
      expect(report.checks.principalPolicyLoaded).toBe(true);
      expect(report.ready).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  it("treats a throwing membership probe as unreachable", async () => {
    const harness = await createTestAppHarness();
    try {
      const report = await evaluateReadiness({
        db: harness.deps.db,
        principalMode: "work-together",
        probeMembershipReachable: async () => {
          throw new Error("db down");
        },
      });
      expect(report.checks.membershipPortReachable).toBe(false);
      expect(report.ready).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  it("bounds a hung membership probe with the configured timeout", async () => {
    const harness = await createTestAppHarness();
    try {
      const deps: ReadinessDeps = {
        db: harness.deps.db,
        principalMode: "work-together",
        probeMembershipReachable: () => new Promise<boolean>(() => {}),
        membershipProbeTimeoutMs: 20,
      };
      const report = await evaluateReadiness(deps);
      expect(report.checks.membershipPortReachable).toBe(false);
      expect(report.ready).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });
});

describe("GET /readyz route", () => {
  it("returns 200 with a not-applicable membership check in local-owner mode", async () => {
    const harness = await createTestAppHarness();
    const server = createApp(harness.deps);
    try {
      const response = await server.app.request("/readyz");
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ready: boolean;
        mode: string;
        checks: {
          sqliteMigrationsAtHead: boolean;
          principalPolicyLoaded: boolean;
          membershipPortReachable: unknown;
        };
      };
      expect(body.ready).toBe(true);
      expect(body.mode).toBe("local-owner");
      expect(body.checks.sqliteMigrationsAtHead).toBe(true);
      expect(body.checks.membershipPortReachable).toBe("not-applicable");
    } finally {
      await server.closeWebSockets();
      await harness.cleanup();
    }
  });

  it("returns 200 in work-together mode when the membership probe succeeds", async () => {
    const harness = await createTestAppHarness();
    const server = createApp(harness.deps, {
      principalMode: "work-together",
      readiness: { probeMembershipReachable: async () => true },
    });
    try {
      const response = await server.app.request("/readyz");
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ready: boolean;
        checks: { membershipPortReachable: unknown };
      };
      expect(body.ready).toBe(true);
      expect(body.checks.membershipPortReachable).toBe(true);
    } finally {
      await server.closeWebSockets();
      await harness.cleanup();
    }
  });

  it("returns 503 in work-together mode when the membership probe fails", async () => {
    const harness = await createTestAppHarness();
    const server = createApp(harness.deps, {
      principalMode: "work-together",
      readiness: { probeMembershipReachable: async () => false },
    });
    try {
      const response = await server.app.request("/readyz");
      expect(response.status).toBe(503);
      const body = (await response.json()) as {
        ready: boolean;
        checks: { membershipPortReachable: unknown };
      };
      expect(body.ready).toBe(false);
      expect(body.checks.membershipPortReachable).toBe(false);
    } finally {
      await server.closeWebSockets();
      await harness.cleanup();
    }
  });
});
