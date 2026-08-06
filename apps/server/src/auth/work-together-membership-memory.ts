import {
  assertWorkTogetherMembershipLookup,
  freezeWorkTogetherMembership,
  WorkTogetherMembershipLookupError,
  type WorkTogetherMembership,
  type WorkTogetherMembershipLookup,
  type WorkTogetherMembershipRole,
  type WorkTogetherMembershipVerifier,
} from "./work-together-membership.js";

export type WorkTogetherMembershipMemorySetArgs = {
  readonly cellId: string;
  readonly subject: string;
  readonly role: WorkTogetherMembershipRole;
  readonly membershipRevision: string;
};

/**
 * In-memory membership verifier for tests and local development.
 * Not wired into production startup by this slice.
 */
export interface WorkTogetherMembershipMemoryFake extends WorkTogetherMembershipVerifier {
  setMembership(args: WorkTogetherMembershipMemorySetArgs): void;
  removeMembership(args: WorkTogetherMembershipLookup): void;
  /**
   * When set, `currentMembership` throws this error after input validation.
   * Pass `null` to clear.
   */
  setFailure(error: Error | null): void;
}

export function createWorkTogetherMembershipMemoryFake(): WorkTogetherMembershipMemoryFake {
  const store = new Map<string, WorkTogetherMembership>();
  let failure: Error | null = null;

  return {
    async currentMembership(args) {
      assertWorkTogetherMembershipLookup(args);
      if (failure !== null) {
        throw failure;
      }
      return store.get(memoryKey(args)) ?? null;
    },

    setMembership(args) {
      assertWorkTogetherMembershipLookup(args);
      let frozen: WorkTogetherMembership;
      try {
        frozen = freezeWorkTogetherMembership({
          role: args.role,
          membershipRevision: args.membershipRevision,
        });
      } catch {
        throw new WorkTogetherMembershipLookupError();
      }
      store.set(memoryKey(args), frozen);
    },

    removeMembership(args) {
      assertWorkTogetherMembershipLookup(args);
      store.delete(memoryKey(args));
    },

    setFailure(error) {
      failure = error;
    },
  };
}

function memoryKey(args: WorkTogetherMembershipLookup): string {
  return `${args.cellId}\0${args.subject}`;
}
