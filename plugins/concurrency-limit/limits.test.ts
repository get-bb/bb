import { describe, expect, it } from "vitest";
import { commitGlobalLimitDraft, commitHostLimitDraft } from "./limits.js";

describe("commitGlobalLimitDraft", () => {
  const configuration = { globalLimit: null, hostOverrides: [] };

  it.each(["1.5", "-1", "10001", "abc"])("rejects %j", (draft) => {
    expect(commitGlobalLimitDraft(configuration, draft)).toEqual({
      kind: "invalid",
    });
  });

  it("saves a whole-number limit", () => {
    expect(commitGlobalLimitDraft(configuration, " 3 ")).toEqual({
      kind: "changed",
      configuration: { globalLimit: 3, hostOverrides: [] },
    });
  });

  it("skips a save when the limit did not change", () => {
    expect(commitGlobalLimitDraft(configuration, "")).toEqual({
      kind: "unchanged",
    });
    expect(
      commitGlobalLimitDraft({ globalLimit: 4, hostOverrides: [] }, "4"),
    ).toEqual({ kind: "unchanged" });
  });
});

describe("commitHostLimitDraft", () => {
  const configuration = {
    globalLimit: 3,
    hostOverrides: [
      { hostId: "host-a", limit: 2 },
      { hostId: "host-b", limit: 5 },
    ],
  };

  it("rejects an invalid number", () => {
    expect(commitHostLimitDraft(configuration, "host-a", "2.5")).toEqual({
      kind: "invalid",
    });
  });

  it("adds an override for a host on Auto", () => {
    expect(commitHostLimitDraft(configuration, "host-c", "1")).toEqual({
      kind: "changed",
      configuration: {
        globalLimit: 3,
        hostOverrides: [
          { hostId: "host-a", limit: 2 },
          { hostId: "host-b", limit: 5 },
          { hostId: "host-c", limit: 1 },
        ],
      },
    });
  });

  it("replaces a host's existing override", () => {
    expect(commitHostLimitDraft(configuration, "host-a", "6")).toEqual({
      kind: "changed",
      configuration: {
        globalLimit: 3,
        hostOverrides: [
          { hostId: "host-b", limit: 5 },
          { hostId: "host-a", limit: 6 },
        ],
      },
    });
  });

  it("returns a host to Auto when its override is cleared", () => {
    expect(commitHostLimitDraft(configuration, "host-a", "")).toEqual({
      kind: "changed",
      configuration: {
        globalLimit: 3,
        hostOverrides: [{ hostId: "host-b", limit: 5 }],
      },
    });
  });

  it("skips a save when the override did not change", () => {
    expect(commitHostLimitDraft(configuration, "host-a", "2")).toEqual({
      kind: "unchanged",
    });
    expect(commitHostLimitDraft(configuration, "host-c", "")).toEqual({
      kind: "unchanged",
    });
  });
});
