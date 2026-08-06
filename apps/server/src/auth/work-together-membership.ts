/**
 * Work Together current-membership port.
 *
 * Cell adapters verify a human subject's current workspace membership through
 * this seam only. Callers never supply a workspace: the authority (database
 * session function or test fake) derives it.
 */

export type WorkTogetherMembershipRole = "owner" | "member";

/**
 * Current membership observation. `membershipRevision` is a canonical positive
 * PostgreSQL bigint decimal string (not a JS number) so values above
 * Number.MAX_SAFE_INTEGER survive intact.
 */
export type WorkTogetherMembership = {
  readonly role: WorkTogetherMembershipRole;
  readonly membershipRevision: string;
};

export type WorkTogetherMembershipLookup = {
  readonly cellId: string;
  readonly subject: string;
};

/**
 * Deep membership authority seam. Implementations fail closed, freeze returned
 * memberships, and never echo subject/cell values in errors.
 */
export interface WorkTogetherMembershipVerifier {
  currentMembership(
    args: WorkTogetherMembershipLookup,
  ): Promise<WorkTogetherMembership | null>;
}

/** Canonical lowercase UUID (no braces, no uppercase). */
export const WORK_TOGETHER_CELL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Clerk-like subject: `user_` plus 1..128 alphanumeric characters. */
export const WORK_TOGETHER_SUBJECT_PATTERN = /^user_[A-Za-z0-9]{1,128}$/u;

/**
 * Canonical positive PostgreSQL bigint decimal form. Length-capped so a full
 * numeric bound check against 2^63-1 is cheap.
 */
export const WORK_TOGETHER_MEMBERSHIP_REVISION_PATTERN = /^[1-9][0-9]{0,18}$/u;

/** PostgreSQL signed bigint maximum (2^63 - 1). */
export const WORK_TOGETHER_PG_BIGINT_MAX = 9_223_372_036_854_775_807n;

const MEMBERSHIP_ROLES = new Set<WorkTogetherMembershipRole>([
  "owner",
  "member",
]);

export class WorkTogetherMembershipInvalidLookupError extends Error {
  constructor(message = "Invalid Work Together membership lookup") {
    super(message);
    this.name = "WorkTogetherMembershipInvalidLookupError";
  }
}

export class WorkTogetherMembershipLookupError extends Error {
  constructor(message = "Work Together membership lookup failed") {
    super(message);
    this.name = "WorkTogetherMembershipLookupError";
  }
}

export function isWorkTogetherMembershipRole(
  value: unknown,
): value is WorkTogetherMembershipRole {
  return (
    typeof value === "string" &&
    MEMBERSHIP_ROLES.has(value as WorkTogetherMembershipRole)
  );
}

export function isCanonicalMembershipRevision(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (!WORK_TOGETHER_MEMBERSHIP_REVISION_PATTERN.test(value)) {
    return false;
  }
  try {
    return BigInt(value) <= WORK_TOGETHER_PG_BIGINT_MAX;
  } catch {
    return false;
  }
}

export function assertWorkTogetherMembershipLookup(
  args: WorkTogetherMembershipLookup,
): void {
  if (
    typeof args.cellId !== "string" ||
    !WORK_TOGETHER_CELL_ID_PATTERN.test(args.cellId)
  ) {
    throw new WorkTogetherMembershipInvalidLookupError();
  }
  if (
    typeof args.subject !== "string" ||
    !WORK_TOGETHER_SUBJECT_PATTERN.test(args.subject)
  ) {
    throw new WorkTogetherMembershipInvalidLookupError();
  }
}

export function freezeWorkTogetherMembership(membership: {
  role: WorkTogetherMembershipRole;
  membershipRevision: string;
}): WorkTogetherMembership {
  if (!isWorkTogetherMembershipRole(membership.role)) {
    throw new WorkTogetherMembershipLookupError();
  }
  if (!isCanonicalMembershipRevision(membership.membershipRevision)) {
    throw new WorkTogetherMembershipLookupError();
  }
  return Object.freeze({
    role: membership.role,
    membershipRevision: membership.membershipRevision,
  });
}

export function parseWorkTogetherMembershipRow(
  row: unknown,
): WorkTogetherMembership {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new WorkTogetherMembershipLookupError();
  }
  const record = row as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "membership_revision" ||
    keys[1] !== "role"
  ) {
    throw new WorkTogetherMembershipLookupError();
  }
  return freezeWorkTogetherMembership({
    role: record.role as WorkTogetherMembershipRole,
    membershipRevision: record.membership_revision as string,
  });
}
