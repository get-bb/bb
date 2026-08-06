import { describe, expect, it } from "vitest";
import { createWorkTogetherMembershipMemoryFake } from "../../src/auth/work-together-membership-memory.js";
import {
  WorkTogetherMembershipInvalidLookupError,
  WorkTogetherMembershipLookupError,
} from "../../src/auth/work-together-membership.js";

const CELL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_CELL = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const SUBJECT = "user_2abcDEF0123456789";
const OTHER_SUBJECT = "user_otherSubject01";
const LARGE_REVISION = "9007199254740993";
const PG_BIGINT_MAX = "9223372036854775807";
const ABOVE_PG_BIGINT_MAX = "9223372036854775808";

describe("work-together membership memory fake", () => {
  it("returns null when unset and freezes set memberships", async () => {
    const fake = createWorkTogetherMembershipMemoryFake();

    await expect(
      fake.currentMembership({ cellId: CELL_ID, subject: SUBJECT }),
    ).resolves.toBeNull();

    fake.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });

    const result = await fake.currentMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
    });
    expect(result).toEqual({ role: "owner", membershipRevision: "1" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => {
      (result as { role: string }).role = "member";
    }).toThrow();
  });

  it("updates and removes memberships per cell and subject", async () => {
    const fake = createWorkTogetherMembershipMemoryFake();

    fake.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "member",
      membershipRevision: "2",
    });
    fake.setMembership({
      cellId: CELL_ID,
      subject: OTHER_SUBJECT,
      role: "owner",
      membershipRevision: "3",
    });
    fake.setMembership({
      cellId: OTHER_CELL,
      subject: SUBJECT,
      role: "member",
      membershipRevision: "4",
    });

    fake.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: LARGE_REVISION,
    });

    await expect(
      fake.currentMembership({ cellId: CELL_ID, subject: SUBJECT }),
    ).resolves.toEqual({
      role: "owner",
      membershipRevision: LARGE_REVISION,
    });
    await expect(
      fake.currentMembership({ cellId: CELL_ID, subject: OTHER_SUBJECT }),
    ).resolves.toEqual({ role: "owner", membershipRevision: "3" });

    fake.removeMembership({ cellId: CELL_ID, subject: SUBJECT });
    await expect(
      fake.currentMembership({ cellId: CELL_ID, subject: SUBJECT }),
    ).resolves.toBeNull();
    await expect(
      fake.currentMembership({ cellId: CELL_ID, subject: OTHER_SUBJECT }),
    ).resolves.toEqual({ role: "owner", membershipRevision: "3" });
  });

  it("preserves bigint revisions above JS safe integer and accepts PG bigint max", async () => {
    const fake = createWorkTogetherMembershipMemoryFake();

    fake.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "member",
      membershipRevision: LARGE_REVISION,
    });
    const large = await fake.currentMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
    });
    expect(large?.membershipRevision).toBe(LARGE_REVISION);

    fake.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: PG_BIGINT_MAX,
    });
    await expect(
      fake.currentMembership({ cellId: CELL_ID, subject: SUBJECT }),
    ).resolves.toEqual({
      role: "owner",
      membershipRevision: PG_BIGINT_MAX,
    });
  });

  it("rejects invalid lookup inputs and invalid membership values without echoing them", () => {
    const fake = createWorkTogetherMembershipMemoryFake();
    const leaked = "user_leakedValue999";

    expect(() =>
      fake.setMembership({
        cellId: "BAD",
        subject: leaked,
        role: "owner",
        membershipRevision: "1",
      }),
    ).toThrow(WorkTogetherMembershipInvalidLookupError);

    expect(() =>
      fake.setMembership({
        cellId: CELL_ID,
        subject: SUBJECT,
        role: "owner",
        membershipRevision: ABOVE_PG_BIGINT_MAX,
      }),
    ).toThrow(WorkTogetherMembershipLookupError);

    expect(() =>
      fake.setMembership({
        cellId: CELL_ID,
        subject: SUBJECT,
        role: "admin" as "owner",
        membershipRevision: "1",
      }),
    ).toThrow(WorkTogetherMembershipLookupError);

    try {
      fake.setMembership({
        cellId: "not-uuid",
        subject: leaked,
        role: "owner",
        membershipRevision: "1",
      });
      expect.unreachable("expected throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(leaked);
      expect(message).not.toContain("not-uuid");
    }
  });

  it("supports failure injection after input validation", async () => {
    const fake = createWorkTogetherMembershipMemoryFake();
    fake.setMembership({
      cellId: CELL_ID,
      subject: SUBJECT,
      role: "owner",
      membershipRevision: "1",
    });

    const injected = new Error("injected membership failure");
    fake.setFailure(injected);

    await expect(
      fake.currentMembership({ cellId: CELL_ID, subject: SUBJECT }),
    ).rejects.toBe(injected);

    await expect(
      fake.currentMembership({
        cellId: "bad",
        subject: SUBJECT,
      }),
    ).rejects.toBeInstanceOf(WorkTogetherMembershipInvalidLookupError);

    fake.setFailure(null);
    await expect(
      fake.currentMembership({ cellId: CELL_ID, subject: SUBJECT }),
    ).resolves.toEqual({ role: "owner", membershipRevision: "1" });
  });
});
