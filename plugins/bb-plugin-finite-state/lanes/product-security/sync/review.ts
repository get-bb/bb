export interface ReviewTransitionInput {
  entityId: string; operationId: string;
  expectedReviewVersion: string;
  action: "approve" | "reject";
}

export interface ReviewTransitionDeps<T> {
  send(input: ReviewTransitionInput): Promise<T>;
  refresh(entityId: string): Promise<{ reviewVersion: string }>;
  isConflict(error: unknown): boolean;
}

export async function transitionReview<T>(deps: ReviewTransitionDeps<T>, input: ReviewTransitionInput): Promise<T> {
  try { return await deps.send(input); }
  catch (error: unknown) {
    if (!deps.isConflict(error)) throw error;
    const refreshed = await deps.refresh(input.entityId);
    return await deps.send({ ...input, expectedReviewVersion: refreshed.reviewVersion });
  }
}
