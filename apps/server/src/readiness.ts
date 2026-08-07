import type { Hono } from "hono";
import { readSqliteMigrationReadiness, type DbConnection } from "@bb/db";

/**
 * Loopback readiness endpoint for the composed cell.
 *
 * A liveness probe (`/health`) only proves the process is up. Readiness proves
 * the cell can actually serve authenticated Room traffic: SQLite migrations are
 * at head, the principal policy adapter is composed, and — in work-together
 * mode — the membership Postgres port is reachable with the cell capability
 * role assumable.
 *
 * The response is intentionally boolean-only: it never discloses the DSN,
 * verification keys, cell/workspace identifiers, membership revision, or any
 * database value. In work-together mode the server binds loopback-only, so this
 * surface is reachable only on 127.0.0.1 (and, for the candidate daemon, the
 * tailnet-restricted Serve route).
 */

export type ReadinessPrincipalMode = "local-owner" | "work-together";

export type MembershipReachabilityProbe = () => Promise<boolean>;

export interface ReadinessDeps {
  readonly db: DbConnection;
  readonly principalMode: ReadinessPrincipalMode;
  /**
   * Present only when the work-together membership runtime was composed, so its
   * presence is itself the "policy adapter loaded" signal for that mode.
   */
  readonly probeMembershipReachable?: MembershipReachabilityProbe;
  /** Bound so a hung membership port cannot hang the readiness request. */
  readonly membershipProbeTimeoutMs?: number;
}

export type MembershipReadinessState = boolean | "not-applicable";

export interface ReadinessReport {
  readonly ready: boolean;
  readonly mode: ReadinessPrincipalMode;
  readonly checks: {
    readonly sqliteMigrationsAtHead: boolean;
    readonly principalPolicyLoaded: boolean;
    readonly membershipPortReachable: MembershipReadinessState;
  };
}

export interface ReadinessInputs {
  readonly mode: ReadinessPrincipalMode;
  readonly sqliteMigrationsAtHead: boolean;
  /** True in local-owner (stock policy always present) or work-together with a composed runtime. */
  readonly workTogetherRuntimeComposed: boolean;
  readonly membershipPortReachable: MembershipReadinessState;
}

const DEFAULT_MEMBERSHIP_PROBE_TIMEOUT_MS = 2_000;

/**
 * Pure readiness decision. Kept separate from I/O so the ready/not-ready matrix
 * is exhaustively unit-testable without a database or Postgres port.
 */
export function computeReadiness(inputs: ReadinessInputs): ReadinessReport {
  const principalPolicyLoaded =
    inputs.mode === "local-owner" || inputs.workTogetherRuntimeComposed;

  const ready =
    inputs.sqliteMigrationsAtHead &&
    principalPolicyLoaded &&
    inputs.membershipPortReachable !== false;

  return {
    ready,
    mode: inputs.mode,
    checks: {
      sqliteMigrationsAtHead: inputs.sqliteMigrationsAtHead,
      principalPolicyLoaded,
      membershipPortReachable: inputs.membershipPortReachable,
    },
  };
}

async function probeMembership(
  deps: ReadinessDeps,
): Promise<MembershipReadinessState> {
  if (deps.principalMode !== "work-together") {
    return "not-applicable";
  }
  if (deps.probeMembershipReachable === undefined) {
    // work-together mode without a composed membership runtime is not ready.
    return false;
  }

  const timeoutMs =
    deps.membershipProbeTimeoutMs ?? DEFAULT_MEMBERSHIP_PROBE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolvePromise) => {
    timer = setTimeout(() => resolvePromise(false), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      deps.probeMembershipReachable().catch(() => false),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function evaluateReadiness(
  deps: ReadinessDeps,
): Promise<ReadinessReport> {
  let sqliteMigrationsAtHead = false;
  try {
    sqliteMigrationsAtHead = readSqliteMigrationReadiness(deps.db).atHead;
  } catch {
    sqliteMigrationsAtHead = false;
  }

  const membershipPortReachable = await probeMembership(deps);

  const workTogetherRuntimeComposed =
    deps.principalMode === "work-together" &&
    deps.probeMembershipReachable !== undefined;

  return computeReadiness({
    mode: deps.principalMode,
    sqliteMigrationsAtHead,
    workTogetherRuntimeComposed,
    membershipPortReachable,
  });
}

/**
 * Registers `GET /readyz` on the root app, alongside `/health`, in the
 * unauthenticated non-`/api/v1` space. Returns 200 when ready, 503 otherwise.
 */
export function registerReadinessRoute(app: Hono, deps: ReadinessDeps): void {
  app.get("/readyz", async (context) => {
    const report = await evaluateReadiness(deps);
    return context.json(report, report.ready ? 200 : 503);
  });
}
