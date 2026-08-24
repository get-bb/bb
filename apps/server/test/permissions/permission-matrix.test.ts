/**
 * A5 / G12 — the server's half of the permission-decision matrix.
 *
 * The runtime matrix (`packages/agent-runtime/src/permission-matrix.test.ts`)
 * pins what happens to an approval request once it reaches the runtime. The
 * only server-side inputs to that decision are the escalation the server
 * attaches to a turn and the shape of the runtime permission policy it builds.
 * Both are pinned here as literal tables.
 */
import {
  permissionEscalationValues,
  permissionModeValues,
  runtimePermissionPolicySchema,
  runtimePermissionScopeValues,
  threadTurnInitiatorSchema,
} from "@bb/domain";
import type { RuntimePermissionPolicy, ThreadTurnInitiator } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { resolvePermissionEscalation } from "../../src/services/threads/thread-runtime-config.js";

// ---------------------------------------------------------------------------
// Escalation by initiator
// ---------------------------------------------------------------------------

/**
 * Only the initiator matters: a user-started turn asks (even on a delegated
 * child, so a sandbox-blocked action surfaces on the parent), and every
 * agent- or system-started turn is denied without a prompt. The function
 * once took the thread as well and never branched on it; the pin on `main`
 * measured root, delegated-child, and fork threads identically, and the
 * thread argument has since been removed.
 */
const EXPECTED_ESCALATION = {
  user: "ask",
  agent: "deny",
  system: "deny",
} satisfies Record<ThreadTurnInitiator, "ask" | "deny">;

const threadTurnInitiatorValues = threadTurnInitiatorSchema.options;

describe("permission escalation by turn initiator", () => {
  it("covers every initiator", () => {
    expect(threadTurnInitiatorValues).toEqual(["user", "agent", "system"]);
    expect(Object.keys(EXPECTED_ESCALATION)).toHaveLength(
      threadTurnInitiatorValues.length,
    );
  });

  it.each(threadTurnInitiatorValues.map((initiator) => [initiator] as const))(
    "%s",
    (initiator) => {
      expect(resolvePermissionEscalation({ initiator })).toBe(
        EXPECTED_ESCALATION[initiator],
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Runtime permission policy shape: which (mode, scope, reviewer, escalation)
// combinations the server is allowed to hand the runtime.
// ---------------------------------------------------------------------------

/**
 * The reviewer vocabulary lives only inside the policy union (the domain no
 * longer exports a value list), so it is spelled out here and pinned to the
 * union at the type level: a new reviewer literal fails this assignment.
 */
const approvalReviewerValues = ["user", "automatic"] as const;
type ReviewerFromPolicy = NonNullable<
  RuntimePermissionPolicy["approvalReviewer"]
>;
const reviewerValuesCoverUnion: [
  (typeof approvalReviewerValues)[number],
] extends [ReviewerFromPolicy]
  ? [ReviewerFromPolicy] extends [(typeof approvalReviewerValues)[number]]
    ? true
    : false
  : false = true;
void reviewerValuesCoverUnion;

const ESCALATION_INPUTS = [...permissionEscalationValues, null] as const;
const REVIEWER_INPUTS = [...approvalReviewerValues, null] as const;

type PolicyCell =
  `${(typeof permissionModeValues)[number]}|${(typeof runtimePermissionScopeValues)[number]}|${NonNullable<(typeof REVIEWER_INPUTS)[number]> | "-"}|${NonNullable<(typeof ESCALATION_INPUTS)[number]> | "-"}`;

/**
 * Exactly five shapes are valid. accept-edits and auto are workspace-scoped
 * and carry an escalation; accept-edits is reviewed by the user, auto by the
 * provider's automatic reviewer; full has no scope limit, no reviewer, and no
 * escalation.
 */
const ACCEPTED_POLICY_SHAPES: readonly PolicyCell[] = [
  "accept-edits|workspace|user|ask",
  "accept-edits|workspace|user|deny",
  "auto|workspace|automatic|ask",
  "auto|workspace|automatic|deny",
  "full|full|-|-",
];

const POLICY_CELLS = permissionModeValues.flatMap((permissionMode) =>
  runtimePermissionScopeValues.flatMap((permissionScope) =>
    REVIEWER_INPUTS.flatMap((approvalReviewer) =>
      ESCALATION_INPUTS.map(
        (permissionEscalation) =>
          ({
            permissionMode,
            permissionScope,
            approvalReviewer,
            permissionEscalation,
          }) as const,
      ),
    ),
  ),
);

describe("runtime permission policy shapes", () => {
  it("enumerates the full cross product", () => {
    expect(permissionModeValues).toEqual(["accept-edits", "auto", "full"]);
    expect(runtimePermissionScopeValues).toEqual(["workspace", "full"]);
    expect(approvalReviewerValues).toEqual(["user", "automatic"]);
    expect(permissionEscalationValues).toEqual(["ask", "deny"]);
    expect(POLICY_CELLS).toHaveLength(3 * 2 * 3 * 3);
    expect(runtimePermissionPolicySchema.options).toHaveLength(3);
  });

  it.each(POLICY_CELLS)(
    "$permissionMode × $permissionScope × $approvalReviewer × $permissionEscalation",
    (cell) => {
      const key: PolicyCell = `${cell.permissionMode}|${cell.permissionScope}|${cell.approvalReviewer ?? "-"}|${cell.permissionEscalation ?? "-"}`;
      expect(runtimePermissionPolicySchema.safeParse(cell).success).toBe(
        ACCEPTED_POLICY_SHAPES.includes(key),
      );
    },
  );
});
