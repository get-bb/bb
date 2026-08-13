export interface ReviewTransitionInput {
  entityId: string; operationId: string;
  expectedReviewVersion: string;
  action: "approve" | "reject";
}

/**
 * Review/standards lifecycle actions have no lane-local registration in WP-40.
 * Ordinary Product Security updates use the production Assurance Studio
 * pusher, which reads the accepted review version before PATCH. A future
 * lifecycle surface must implement 409 refresh/retry there rather than
 * exposing an unwired helper from this lane.
 */
export const REVIEW_TRANSITION_REGISTRATION = "unavailable" as const;
