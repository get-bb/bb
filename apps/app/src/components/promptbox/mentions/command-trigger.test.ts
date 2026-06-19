import { describe, expect, it } from "vitest";
import {
  buildProviderPromptActionProps,
  commandPillDismissedRangeEnd,
  commandTriggerForComposerActions,
} from "./command-trigger";

describe("commandTriggerForComposerActions", () => {
  it("uses the provider-declared skills trigger", () => {
    expect(
      commandTriggerForComposerActions([{ kind: "skills", trigger: "/" }]),
    ).toBe("/");
  });

  it("returns null when the provider has no skills action", () => {
    expect(
      commandTriggerForComposerActions([
        {
          kind: "plan",
          command: { trigger: "/", name: "plan", trailingText: " " },
        },
        {
          kind: "goal",
          command: { trigger: "/", name: "goal", trailingText: " " },
        },
      ]),
    ).toBeNull();
  });
});

describe("buildProviderPromptActionProps", () => {
  it("maps skills and insertion composer actions into prompt action props", () => {
    expect(
      buildProviderPromptActionProps([
        { kind: "skills", trigger: "/" },
        {
          kind: "plan",
          command: { trigger: "/", name: "plan", trailingText: " " },
        },
        {
          kind: "goal",
          command: { trigger: "/", name: "goal", trailingText: " " },
        },
      ]),
    ).toEqual({
      skillsTrigger: "/",
      promptActions: [
        { kind: "skills", text: "/" },
        {
          kind: "plan",
          command: { trigger: "/", name: "plan", trailingText: " " },
          text: "/plan ",
        },
        {
          kind: "goal",
          command: { trigger: "/", name: "goal", trailingText: " " },
          text: "/goal ",
        },
      ],
    });
  });
});

describe("commandPillDismissedRangeEnd", () => {
  it("counts the command pill as a one-position editor atom", () => {
    expect(
      commandPillDismissedRangeEnd({
        triggerPosition: 5,
        trailingText: " ",
      }),
    ).toBe(7);
  });

  it("does not include serialized command name length", () => {
    expect(
      commandPillDismissedRangeEnd({
        triggerPosition: 5,
        trailingText: "",
      }),
    ).toBe(6);
  });
});
