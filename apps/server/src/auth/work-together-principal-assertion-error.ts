/**
 * Sanitized Work Together Principal assertion failure.
 *
 * Messages must never echo tokens, kids, subjects, targets, issuers, DB
 * details, or signature-failure specifics.
 */
export class WorkTogetherPrincipalAssertionError extends Error {
  constructor() {
    super("Work Together principal assertion rejected");
    this.name = "WorkTogetherPrincipalAssertionError";
  }
}

export function rejectWorkTogetherPrincipalAssertion(): never {
  throw new WorkTogetherPrincipalAssertionError();
}
